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

// 页面加载时检查登录状态
window.addEventListener('load', () => {
  checkLoginStatus();
});

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

async function searchMPAccount() {
  const accountName = document.getElementById('mpAccountName').value.trim();
  
  if (!accountName) {
    showStatus('请输入公众号名称', 'warning');
    return;
  }
  
  const button = document.getElementById('searchMPAccountBtn');
  const loading = document.getElementById('loadingMP');
  
  button.disabled = true;
  button.textContent = '搜索中...';
  loading.style.display = 'block';
  
  try {
    const { mpCredentials } = await chrome.storage.local.get('mpCredentials');
    
    if (!mpCredentials || !mpCredentials.token) {
      throw new Error('未登录，请先登录公众号后台');
    }
    
    const response = await chrome.runtime.sendMessage({
      action: 'searchMPArticles',
      accountName: accountName,
      credentials: mpCredentials
    });
    
    if (response.success && response.articles && response.articles.length > 0) {
      displayMPArticleList(response.articles, accountName);
      showStatus(`✓ 找到 ${response.articles.length} 篇文章`, 'success');
    } else {
      showStatus(response.error || '未找到文章', 'warning');
    }
  } catch (error) {
    showStatus('✗ ' + error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '🔍 搜索公众号文章';
    loading.style.display = 'none';
  }
}

// 显示文章列表
function displayMPArticleList(articles, accountName) {
  const container = document.getElementById('mpArticleListContent');
  const articleList = document.getElementById('mpArticleList');
  const accountInfo = document.getElementById('accountInfo');
  
  accountInfo.innerHTML = `
    <div class="account-name">${accountName}</div>
    <div class="account-meta">共找到 ${articles.length} 篇文章</div>
  `;
  accountInfo.style.display = 'block';
  
  container.innerHTML = articles.map((article, index) => `
    <div class="article-item">
      <input type="checkbox" class="article-checkbox" data-index="${index}" checked>
      <div class="article-info">
        <div class="article-title">${article.title}</div>
        <div class="article-meta">${article.date || ''} ${article.author ? '· ' + article.author : ''}</div>
      </div>
    </div>
  `).join('');
  
  articleList.style.display = 'block';
  chrome.storage.local.set({ pendingArticles: articles });
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

// 下载选中文章
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
  
  let successCount = 0;
  
  for (let i = 0; i < selectedArticles.length; i++) {
    try {
      await convertUrlToMarkdown(selectedArticles[i].url);
      successCount++;
    } catch (error) {
      console.error('下载失败:', error);
    }
    updateProgress(i + 1, selectedArticles.length);
    await sleep(1500);
  }
  
  hideProgress();
  showStatus(`✓ 已下载 ${successCount}/${selectedArticles.length} 篇文章`, 'success');
  
  button.disabled = false;
  button.textContent = '下载选中文章';
});

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