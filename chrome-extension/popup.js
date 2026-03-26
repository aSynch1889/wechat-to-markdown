// ==================== popup.js - 完整代码 ====================

// Tab切换
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
  });
});

// 页面加载时检查登录状态和下载进度
window.addEventListener('load', () => {
  checkLoginStatus();
  checkDownloadProgress();
});

// 检查是否有正在进行的下载任务
async function checkDownloadProgress() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getDownloadProgress'
    });
    
    if (response && response.status === 'downloading') {
      showProgress(response.current, response.total);
      startProgressMonitor(response.total);
    }
  } catch (error) {
    // 忽略错误
  }
}

// ==================== 单篇转换 ====================
document.getElementById('convertBtn').addEventListener('click', async () => {
  await convertCurrentPage();
});

async function convertCurrentPage() {
  const button = document.getElementById('convertBtn');
  button.disabled = true;
  button.textContent = '转换中...';
  showStatus('正在提取文章内容...', 'info');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('mp.weixin.qq.com')) {
      throw new Error('请在微信公众号文章页面使用此扩展');
    }
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractArticle
    });
    
    const article = results[0].result;
    if (!article || !article.title) {
      throw new Error('未能提取文章内容');
    }
    
    const markdown = convertToMarkdown(article);
    await downloadMarkdown(markdown, article.title);
    
    showStatus('✓ 转换成功！文件已下载', 'success');
  } catch (error) {
    showStatus('✗ ' + error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '转换当前页面';
  }
}

// ==================== 批量转换 ====================
document.getElementById('batchConvertBtn').addEventListener('click', async () => {
  await batchConvert();
});

async function batchConvert() {
  const textarea = document.getElementById('batchUrls');
  const urls = textarea.value.split('\n')
    .map(url => url.trim())
    .filter(url => url && url.includes('mp.weixin.qq.com'));
  
  if (urls.length === 0) {
    showStatus('请输入至少一个有效的文章链接', 'warning');
    return;
  }
  
  const button = document.getElementById('batchConvertBtn');
  button.disabled = true;
  button.textContent = '转换中...';
  
  showProgress(0, urls.length);
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < urls.length; i++) {
    try {
      await convertUrlToMarkdown(urls[i]);
      successCount++;
    } catch (error) {
      failCount++;
      console.error(`转换失败: ${urls[i]}`, error);
    }
    
    updateProgress(i + 1, urls.length);
    await sleep(1000);
  }
  
  hideProgress();
  showStatus(`✓ 批量转换完成！成功: ${successCount}, 失败: ${failCount}`, 'success');
  
  button.disabled = false;
  button.textContent = '开始批量转换';
}

// 保留旧方法用于批量转换标签页（单篇转换仍使用标签页方式）
async function convertUrlToMarkdown(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, async (tab) => {
      try {
        await sleep(3000);
        
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: extractArticle
        });
        
        const article = results[0].result;
        if (!article || !article.title) throw new Error('提取失败');
        
        const markdown = convertToMarkdown(article);
        await downloadMarkdown(markdown, article.title);
        
        chrome.tabs.remove(tab.id);
        resolve();
      } catch (error) {
        chrome.tabs.remove(tab.id);
        reject(error);
      }
    });
  });
}

// ==================== 公众号后台API ====================

// 检查登录状态
async function checkLoginStatus() {
  try {
    // 首先检查当前标签页是否在公众号后台，如果是则尝试自动提取token
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes('mp.weixin.qq.com') && tab.url.includes('token=')) {
        console.log('检测到当前标签页有token，自动提取...');
        const urlParams = new URL(tab.url);
        const token = urlParams.searchParams.get('token');
        
        if (token && /^\d+$/.test(token)) {
          const cookies = await chrome.cookies.getAll({
            url: 'https://mp.weixin.qq.com'
          });
          
          const credentials = {
            token: token,
            timestamp: Date.now(),
            cookies: cookies.map(c => ({ 
              name: c.name, 
              value: c.value,
              domain: c.domain
            })),
            extractMethod: 'auto_detect'
          };
          
          await chrome.storage.local.set({ mpCredentials: credentials });
          updateLoginUI(true, credentials);
          return true;
        }
      }
    } catch (error) {
      console.log('检查当前标签页token失败:', error);
    }
    
    // 检查存储的token
    const { mpCredentials } = await chrome.storage.local.get('mpCredentials');
    
    if (mpCredentials && mpCredentials.token) {
      const isValid = await verifyToken(mpCredentials.token);
      
      if (isValid) {
        updateLoginUI(true, mpCredentials);
        return true;
      } else {
        await chrome.storage.local.remove('mpCredentials');
        updateLoginUI(false);
        return false;
      }
    } else {
      updateLoginUI(false);
      return false;
    }
  } catch (error) {
    console.error('检查登录状态失败:', error);
    updateLoginUI(false);
    return false;
  }
}

// 验证Token有效性
async function verifyToken(token) {
  try {
    if (!token || token.length < 5) {
      return false;
    }
    // 微信的token通常是纯数字
    return /^\d+$/.test(token);
  } catch (error) {
    return false;
  }
}

// 更新登录UI
function updateLoginUI(isLoggedIn, credentials = null) {
  const statusBox = document.getElementById('loginStatusBox');
  const statusText = document.getElementById('loginStatusText');
  const statusDetail = document.getElementById('loginStatusDetail');
  const loginBtn = document.getElementById('loginMPBtn');
  const logoutBtn = document.getElementById('logoutMPBtn');
  const searchSection = document.getElementById('searchSection');
  
  if (isLoggedIn && credentials) {
    statusBox.className = 'login-status logged-in';
    statusBox.querySelector('.status-icon').textContent = '🟢';
    statusText.textContent = '已登录';
    
    const loginTime = new Date(credentials.timestamp).toLocaleString('zh-CN');
    const tokenPreview = credentials.token.substring(0, 15) + '...';
    statusDetail.textContent = `Token: ${tokenPreview} | ${loginTime}`;
    
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'block';
    searchSection.style.display = 'block';
    
    console.log('UI更新为已登录状态');
  } else {
    statusBox.className = 'login-status logged-out';
    statusBox.querySelector('.status-icon').textContent = '🔴';
    statusText.textContent = '未登录';
    statusDetail.textContent = '需要登录公众号后台';
    loginBtn.style.display = 'block';
    logoutBtn.style.display = 'none';
    searchSection.style.display = 'none';
    
    console.log('UI更新为未登录状态');
  }
}

// 登录公众号后台
document.getElementById('loginMPBtn').addEventListener('click', async () => {
  const loginUrl = 'https://mp.weixin.qq.com/';
  
  showStatus('正在打开公众号后台，请使用微信扫码登录...', 'info');
  
  const newTab = await chrome.tabs.create({ url: loginUrl, active: true });
  
  const checkInterval = setInterval(async () => {
    try {
      const tab = await chrome.tabs.get(newTab.id);
      
      console.log('检查URL:', tab.url);
      
      if (tab.url && tab.url.includes('token=')) {
        console.log('✅ 检测到token参数！');
        clearInterval(checkInterval);
        
        const urlParams = new URL(tab.url);
        const token = urlParams.searchParams.get('token');
        
        if (token) {
          console.log('提取到Token:', token);
          
          const cookies = await chrome.cookies.getAll({
            url: 'https://mp.weixin.qq.com'
          });
          
          const credentials = {
            token: token,
            timestamp: Date.now(),
            cookies: cookies.map(c => ({ 
              name: c.name, 
              value: c.value,
              domain: c.domain
            })),
            extractMethod: 'url',
            url: tab.url
          };
          
          await chrome.storage.local.set({ mpCredentials: credentials });
          
          showStatus('✓ 登录成功！Token: ' + token.substring(0, 15) + '...', 'success');
          updateLoginUI(true, credentials);
          
          setTimeout(() => {
            chrome.tabs.remove(newTab.id).catch(() => {});
          }, 1000);
        } else {
          console.error('URL中有token参数但提取失败');
        }
      }
    } catch (error) {
      console.log('标签页已关闭或出错:', error);
      clearInterval(checkInterval);
    }
  }, 2000);
  
  setTimeout(() => {
    clearInterval(checkInterval);
  }, 60000);
});

// 从当前页面提取Token
document.getElementById('extractFromCurrentBtn').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('mp.weixin.qq.com')) {
      throw new Error('请在微信公众号后台页面使用此功能');
    }
    
    if (tab.url.includes('token=')) {
      const urlParams = new URL(tab.url);
      const token = urlParams.searchParams.get('token');
      
      if (token) {
        const cookies = await chrome.cookies.getAll({
          url: 'https://mp.weixin.qq.com'
        });
        
        const credentials = {
          token: token,
          timestamp: Date.now(),
          cookies: cookies.map(c => ({ 
            name: c.name, 
            value: c.value 
          })),
          extractMethod: 'current_page'
        };
        
        await chrome.storage.local.set({ mpCredentials: credentials });
        showStatus('✓ 从当前页面提取Token成功: ' + token, 'success');
        updateLoginUI(true, credentials);
      } else {
        throw new Error('URL中没有token参数');
      }
    } else {
      throw new Error('当前页面URL中没有token参数，请确保已登录后台');
    }
  } catch (error) {
    showStatus('✗ ' + error.message, 'error');
  }
});

// 退出登录
document.getElementById('logoutMPBtn').addEventListener('click', async () => {
  if (confirm('确定要退出登录吗？')) {
    await chrome.storage.local.remove('mpCredentials');
    updateLoginUI(false);
    showStatus('✓ 已退出登录', 'success');
  }
});

// 调试按钮
document.getElementById('debugLoginBtn').addEventListener('click', async () => {
  console.log('=== 开始调试登录状态 ===');
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('当前标签页URL:', tab.url);
  
  if (tab.url && tab.url.includes('token=')) {
    try {
      const urlParams = new URL(tab.url);
      const token = urlParams.searchParams.get('token');
      console.log('URL中的Token:', token);
    } catch (error) {
      console.log('URL解析失败:', error);
    }
  } else {
    console.log('URL中没有token参数');
  }
  
  const cookies = await chrome.cookies.getAll({
    url: 'https://mp.weixin.qq.com'
  });
  console.log('微信Cookie数量:', cookies.length);
  console.log('Cookie列表:');
  cookies.forEach(c => {
    console.log(`  ${c.name}: ${c.value.substring(0, 30)}...`);
  });
  
  const { mpCredentials } = await chrome.storage.local.get('mpCredentials');
  if (mpCredentials) {
    console.log('存储的凭证:');
    console.log('  Token:', mpCredentials.token);
    console.log('  时间:', new Date(mpCredentials.timestamp).toLocaleString());
    console.log('  提取方式:', mpCredentials.extractMethod);
  } else {
    console.log('❌ 未找到存储的凭证');
  }
  
  console.log('=== 调试完成 ===');
  alert('调试信息已输出到控制台（按F12查看）');
});

// 手动输入Token
document.getElementById('manualTokenBtn').addEventListener('click', async () => {
  const token = prompt('请输入Token（纯数字，如：450735061）:');
  
  if (token && /^\d+$/.test(token)) {
    const credentials = {
      token: token,
      timestamp: Date.now(),
      cookies: [],
      extractMethod: 'manual'
    };
    
    await chrome.storage.local.set({ mpCredentials: credentials });
    showStatus('✓ Token已保存: ' + token, 'success');
    updateLoginUI(true, credentials);
  } else {
    showStatus('Token格式不正确（应该是纯数字）', 'error');
  }
});

// 搜索公众号文章
document.getElementById('searchMPAccountBtn').addEventListener('click', async () => {
  await searchMPAccount();
});

let currentSearchInterval = null;
let currentSearchAccount = null;

async function searchMPAccount() {
  const accountName = document.getElementById('mpAccountName').value.trim();
  
  if (!accountName) {
    showStatus('请输入公众号名称', 'warning');
    return;
  }
  
  const button = document.getElementById('searchMPAccountBtn');
  const cancelBtn = document.getElementById('cancelSearchBtn');
  const loading = document.getElementById('loadingMP');
  
  // 先检查缓存
  try {
    const cacheResponse = await chrome.runtime.sendMessage({
      action: 'getCachedArticles',
      accountName: accountName
    });
    
    if (cacheResponse && cacheResponse.articles && cacheResponse.articles.length > 0) {
      const useCache = confirm(`发现缓存数据（${cacheResponse.articles.length} 篇文章），是否使用缓存？\n\n点击"确定"使用缓存，点击"取消"重新搜索。`);
      if (useCache) {
        displayMPArticleList(cacheResponse.articles, accountName);
        showStatus(`✓ 从缓存加载 ${cacheResponse.articles.length} 篇文章${cacheResponse.incomplete ? '（未完成）' : ''}`, 'success');
        return;
      }
    }
  } catch (error) {
    console.log('检查缓存失败:', error);
  }
  
  button.disabled = true;
  button.textContent = '搜索中...';
  cancelBtn.style.display = 'block';
  loading.style.display = 'block';
  loading.textContent = '正在搜索公众号...';
  currentSearchAccount = accountName;
  
  // 清除之前的文章列表显示
  document.getElementById('mpArticleList').style.display = 'none';
  document.getElementById('accountInfo').style.display = 'none';
  
  // 启动进度监听（实时更新已获取的文章）
  let lastArticleCount = 0;
  currentSearchInterval = setInterval(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getSearchProgress'
      });
      
      if (response) {
        const progress = response.progress;
        const articles = response.articles || [];
        
        if (progress && progress.status) {
          if (progress.message) {
            loading.textContent = progress.message;
          }
          
          // 实时显示已获取的文章（增量更新）
          if (articles.length > lastArticleCount) {
            displayMPArticleList(articles, accountName, true); // true表示增量更新
            lastArticleCount = articles.length;
          }
          
          if (progress.status === 'completed' || progress.status === 'error') {
            clearInterval(currentSearchInterval);
            currentSearchInterval = null;
            
            // 最终显示所有文章
            if (articles.length > 0) {
              displayMPArticleList(articles, accountName);
              showStatus(`✓ 找到 ${articles.length} 篇文章`, 'success');
            }
            
            button.disabled = false;
            button.textContent = '🔍 搜索公众号文章';
            cancelBtn.style.display = 'none';
            loading.style.display = 'none';
          }
        }
      }
    } catch (error) {
      // 忽略错误
    }
  }, 500);
  
  try {
    const { mpCredentials } = await chrome.storage.local.get('mpCredentials');
    
    if (!mpCredentials || !mpCredentials.token) {
      throw new Error('未登录，请先登录公众号后台');
    }
    
    // 异步启动搜索（不等待完成，让它在后台运行）
    chrome.runtime.sendMessage({
      action: 'searchMPArticles',
      accountName: accountName,
      credentials: mpCredentials
    }, (response) => {
      if (currentSearchInterval) {
        clearInterval(currentSearchInterval);
        currentSearchInterval = null;
      }
      
      if (chrome.runtime.lastError) {
        showStatus('✗ ' + chrome.runtime.lastError.message, 'error');
        button.disabled = false;
        button.textContent = '🔍 搜索公众号文章';
        cancelBtn.style.display = 'none';
        loading.style.display = 'none';
        return;
      }
      
      console.log('搜索响应:', response);
      
      if (response.success && response.articles && response.articles.length > 0) {
        displayMPArticleList(response.articles, accountName);
        showStatus(`✓ 找到 ${response.articles.length} 篇文章${response.fromCache ? '（来自缓存）' : ''}`, 'success');
      } else if (response.error && response.error !== '搜索已取消') {
        showStatus(response.error || '未找到文章', 'warning');
      }
      
      button.disabled = false;
      button.textContent = '🔍 搜索公众号文章';
      cancelBtn.style.display = 'none';
      loading.style.display = 'none';
    });
    
    // 不等待完成，让搜索在后台进行
    showStatus('✓ 搜索任务已启动，可在后台继续运行', 'info');
  } catch (error) {
    if (currentSearchInterval) {
      clearInterval(currentSearchInterval);
      currentSearchInterval = null;
    }
    showStatus('✗ ' + error.message, 'error');
    button.disabled = false;
    button.textContent = '🔍 搜索公众号文章';
    cancelBtn.style.display = 'none';
    loading.style.display = 'none';
  }
}

// 取消搜索
document.getElementById('cancelSearchBtn').addEventListener('click', async () => {
  if (currentSearchInterval) {
    clearInterval(currentSearchInterval);
    currentSearchInterval = null;
  }
  
  try {
    await chrome.runtime.sendMessage({
      action: 'cancelSearch'
    });
    
    const button = document.getElementById('searchMPAccountBtn');
    const cancelBtn = document.getElementById('cancelSearchBtn');
    const loading = document.getElementById('loadingMP');
    
    button.disabled = false;
    button.textContent = '🔍 搜索公众号文章';
    cancelBtn.style.display = 'none';
    loading.style.display = 'none';
    
    // 显示已获取的文章（如果有）
    const response = await chrome.runtime.sendMessage({
      action: 'getSearchProgress'
    });
    
    if (response && response.articles && response.articles.length > 0) {
      displayMPArticleList(response.articles, currentSearchAccount);
      showStatus(`搜索已取消，已获取 ${response.articles.length} 篇文章`, 'warning');
    } else {
      showStatus('搜索已取消', 'info');
    }
  } catch (error) {
    showStatus('✗ 取消搜索失败: ' + error.message, 'error');
  }
});

// 显示文章列表
function displayMPArticleList(articles, accountName, incremental = false) {
  console.log('displayMPArticleList 被调用，文章数量:', articles.length, '增量更新:', incremental);
  
  const container = document.getElementById('mpArticleListContent');
  const articleList = document.getElementById('mpArticleList');
  const accountInfo = document.getElementById('accountInfo');
  
  if (!container || !articleList || !accountInfo) {
    console.error('找不到必要的DOM元素');
    return;
  }
  
  accountInfo.innerHTML = `
    <div class="account-name">${accountName}</div>
    <div class="account-meta">已获取 ${articles.length} 篇文章${incremental ? '（正在搜索中...）' : ''}</div>
  `;
  accountInfo.style.display = 'block';
  
  if (incremental) {
    // 增量更新：只添加新文章
    const existingCount = container.querySelectorAll('.article-item').length;
    const newArticles = articles.slice(existingCount);
    
    if (newArticles.length > 0) {
      const html = newArticles.map((article, index) => `
        <div class="article-item">
          <input type="checkbox" class="article-checkbox" data-index="${existingCount + index}" checked>
          <div class="article-info">
            <div class="article-title">${article.title || '无标题'}</div>
            <div class="article-meta">${article.date || ''} ${article.author ? '· ' + article.author : ''}</div>
          </div>
        </div>
      `).join('');
      
      container.insertAdjacentHTML('beforeend', html);
    }
  } else {
    // 完整更新：重新渲染所有文章
    const html = articles.map((article, index) => `
      <div class="article-item">
        <input type="checkbox" class="article-checkbox" data-index="${index}" checked>
        <div class="article-info">
          <div class="article-title">${article.title || '无标题'}</div>
          <div class="article-meta">${article.date || ''} ${article.author ? '· ' + article.author : ''}</div>
        </div>
      </div>
    `).join('');
    
    container.innerHTML = html;
  }
  
  articleList.style.display = 'block';
  chrome.storage.local.set({ pendingArticles: articles });
  
  // 验证实际显示的文章数量
  const displayedItems = container.querySelectorAll('.article-item');
  console.log('实际显示的文章项数量:', displayedItems.length);
}

// 选择控制
document.getElementById('selectAllMPBtn').addEventListener('click', () => {
  document.querySelectorAll('.article-checkbox').forEach(cb => cb.checked = true);
});

document.getElementById('selectNoneMPBtn').addEventListener('click', () => {
  document.querySelectorAll('.article-checkbox').forEach(cb => cb.checked = false);
});

document.getElementById('selectInvertMPBtn').addEventListener('click', () => {
  document.querySelectorAll('.article-checkbox').forEach(cb => cb.checked = !cb.checked);
});

// 下载选中文章（使用无头模式，支持后台运行）
document.getElementById('downloadMPSelectedBtn').addEventListener('click', async () => {
  const checkboxes = document.querySelectorAll('.article-checkbox:checked');
  
  if (checkboxes.length === 0) {
    showStatus('请至少选择一篇文章', 'warning');
    return;
  }
  
  const button = document.getElementById('downloadMPSelectedBtn');
  button.disabled = true;
  button.textContent = '下载中...';
  
  const { pendingArticles } = await chrome.storage.local.get('pendingArticles');
  const selectedArticles = Array.from(checkboxes).map(cb => {
    return pendingArticles[parseInt(cb.dataset.index)];
  });
  
  showProgress(0, selectedArticles.length);
  
  // 启动进度监听（即使popup关闭也能继续下载）
  startProgressMonitor(selectedArticles.length);
  
  try {
    // 获取凭证
    const { mpCredentials } = await chrome.storage.local.get('mpCredentials');
    
    // 发送到background.js进行无头下载（支持后台运行）
    // 注意：这个操作是异步的，不会阻塞，下载会在后台继续
    chrome.runtime.sendMessage({
      action: 'downloadArticles',
      articles: selectedArticles,
      credentials: mpCredentials || {}
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('发送下载请求失败:', chrome.runtime.lastError);
        showStatus('✗ ' + chrome.runtime.lastError.message, 'error');
        button.disabled = false;
        button.textContent = '下载选中文章';
        hideProgress();
        return;
      }
      
      if (response && response.success) {
        // 进度监听会更新状态，这里不需要额外处理
        console.log('下载任务已启动');
      } else {
        showStatus('✗ ' + (response?.error || '下载失败'), 'error');
        button.disabled = false;
        button.textContent = '下载选中文章';
        hideProgress();
      }
    });
    
    // 不等待完成，让下载在后台进行
    showStatus('✓ 下载任务已启动，可在后台继续运行', 'info');
  } catch (error) {
    showStatus('✗ ' + error.message, 'error');
    button.disabled = false;
    button.textContent = '下载选中文章';
    hideProgress();
  }
});

// 启动进度监听
function startProgressMonitor(total) {
  let progressInterval;
  
  const checkProgress = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getDownloadProgress'
      });
      
      if (response) {
        updateProgress(response.current, response.total);
        
        if (response.status === 'completed') {
          if (progressInterval) {
            clearInterval(progressInterval);
          }
          const button = document.getElementById('downloadMPSelectedBtn');
          if (button) {
            button.disabled = false;
            button.textContent = '下载选中文章';
          }
          showStatus(`✓ 下载完成！成功: ${response.success || 0}, 失败: ${response.failed || 0}`, 'success');
          hideProgress();
        }
      }
    } catch (error) {
      // popup可能已关闭，忽略错误
      if (progressInterval) {
        clearInterval(progressInterval);
      }
    }
  };
  
  // 立即检查一次
  checkProgress();
  
  // 然后每秒检查一次
  progressInterval = setInterval(checkProgress, 1000);
  
  // 30分钟后自动停止监听
  setTimeout(() => {
    if (progressInterval) {
      clearInterval(progressInterval);
    }
  }, 30 * 60 * 1000);
}

// ==================== 工具函数 ====================

function extractArticle() {
  const article = {
    title: '',
    author: '',
    publishTime: '',
    content: '',
    url: window.location.href
  };
  
  const titleEl = document.querySelector('.rich_media_title, #activity-name');
  if (titleEl) article.title = titleEl.textContent.trim();
  
  const authorEl = document.querySelector('#js_name');
  if (authorEl) article.author = authorEl.textContent.trim();
  
  const timeEl = document.querySelector('#publish_time');
  if (timeEl) article.publishTime = timeEl.textContent.trim();
  
  const contentEl = document.querySelector('#js_content');
  if (contentEl) article.content = contentEl.innerHTML;
  
  return article;
}

function convertToMarkdown(article) {
  let markdown = `# ${article.title}\n\n`;
  
  if (article.author) markdown += `**作者**: ${article.author}\n\n`;
  if (article.publishTime) markdown += `**发布时间**: ${article.publishTime}\n\n`;
  markdown += `**原文链接**: ${article.url}\n\n---\n\n`;
  
  let content = article.content || '';
  
  content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  content = content.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  content = content.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  content = content.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  content = content.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  content = content.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  content = content.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  content = content.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  content = content.replace(/<img[^>]*data-src=["']([^"']*)["'][^>]*>/gi, '![]($1)\n');
  content = content.replace(/<img[^>]*src=["']([^"']*)["'][^>]*>/gi, '![]($1)\n');
  content = content.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  content = content.replace(/<br\s*\/?>/gi, '\n');
  content = content.replace(/<[^>]+>/g, '');
  content = content.replace(/&nbsp;/g, ' ');
  content = content.replace(/&lt;/g, '<');
  content = content.replace(/&gt;/g, '>');
  content = content.replace(/&amp;/g, '&');
  content = content.replace(/\n{3,}/g, '\n\n');
  
  markdown += content.trim();
  return markdown;
}

async function downloadMarkdown(content, filename) {
  filename = filename.replace(/[\\/*?:"<>|]/g, '').substring(0, 100);
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  return new Promise((resolve) => {
    chrome.downloads.download({
      url: url,
      filename: `${filename}.md`,
      saveAs: false
    }, (downloadId) => {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve(downloadId);
    });
  });
}

function showStatus(message, type = 'info') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = type;
  status.style.display = 'block';
  if (type === 'success') setTimeout(() => status.style.display = 'none', 3000);
}

function showProgress(current, total) {
  document.getElementById('progressSection').style.display = 'block';
  updateProgress(current, total);
}

function updateProgress(current, total) {
  const percent = Math.round((current / total) * 100);
  document.getElementById('progressFill').style.width = percent + '%';
  document.getElementById('progressText').textContent = `${current} / ${total} (${percent}%)`;
}

function hideProgress() {
  document.getElementById('progressSection').style.display = 'none';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}