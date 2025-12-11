document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
  });
});

// 单篇转换
document.getElementById('convertBtn').addEventListener('click', async () => {
  await convertCurrentPage();
});

// 批量转换
document.getElementById('batchConvertBtn').addEventListener('click', async () => {
  await batchConvert();
});

// 打开历史文章页
document.getElementById('openHistoryBtn').addEventListener('click', async () => {
  await openHistoryPage();
});

// 获取公众号文章
document.getElementById('fetchAccountBtn').addEventListener('click', async () => {
  await fetchAccountArticles();
});

// 从当前页面提取链接
document.getElementById('extractFromCurrentPageBtn').addEventListener('click', async () => {
  await extractLinksFromCurrentPage();
});

// 从剪贴板粘贴
document.getElementById('pasteFromClipboardBtn').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    const textarea = document.getElementById('batchUrls');
    textarea.value = text;
    showStatus('✓ 已从剪贴板粘贴', 'success');
  } catch (error) {
    showStatus('✗ 无法读取剪贴板，请手动粘贴', 'error');
  }
});

// 选择控制
document.getElementById('selectAllBtn')?.addEventListener('click', () => {
  document.querySelectorAll('.article-checkbox').forEach(cb => cb.checked = true);
});

document.getElementById('selectNoneBtn')?.addEventListener('click', () => {
  document.querySelectorAll('.article-checkbox').forEach(cb => cb.checked = false);
});

document.getElementById('selectInvertBtn')?.addEventListener('click', () => {
  document.querySelectorAll('.article-checkbox').forEach(cb => cb.checked = !cb.checked);
});

// 下载选中文章
document.getElementById('downloadSelectedBtn')?.addEventListener('click', async () => {
  await downloadSelected();
});

// 转换当前页面
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

// 批量转换
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

// 打开历史文章页面
async function openHistoryPage() {
  const button = document.getElementById('openHistoryBtn');
  button.disabled = true;
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('mp.weixin.qq.com')) {
      throw new Error('请在微信公众号文章页面使用此功能');
    }
    
    let biz = null;
    
    // 方法1: 从URL查询参数中提取 __biz
    const bizMatch = tab.url.match(/[?&]__biz=([^&]+)/);
    if (bizMatch) {
      biz = decodeURIComponent(bizMatch[1]);
    }
    
    // 方法2: 如果方法1失败，尝试从页面中提取
    if (!biz) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: extractBizFromPage
        });
        
        if (results && results[0] && results[0].result) {
          biz = results[0].result;
        }
      } catch (e) {
        console.log('从页面提取失败:', e);
      }
    }
    
    // 方法3: 尝试从URL的hash中提取
    if (!biz) {
      const hashMatch = tab.url.match(/[#&]__biz=([^&]+)/);
      if (hashMatch) {
        biz = decodeURIComponent(hashMatch[1]);
      }
    }
    
    // 方法4: 尝试从页面链接中提取
    if (!biz) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: extractBizFromLinks
        });
        
        if (results && results[0] && results[0].result) {
          biz = results[0].result;
        }
      } catch (e) {
        console.log('从链接提取失败:', e);
      }
    }
    
    if (!biz) {
      throw new Error('无法提取公众号信息，请确保在微信公众号文章页面使用此功能');
    }
    
    // 构建历史文章页面URL - 尝试多种格式
    // 格式1: 不带 wechat_redirect
    const historyUrl1 = `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(biz)}&scene=124`;
    // 格式2: 使用 getmsg 参数
    const historyUrl2 = `https://mp.weixin.qq.com/mp/profile_ext?action=getmsg&__biz=${encodeURIComponent(biz)}&f=json&offset=0&count=10`;
    // 格式3: 标准格式（可能需要在微信客户端打开）
    const historyUrl3 = `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(biz)}&scene=124#wechat_redirect`;
    
    // 先尝试格式1（最可能在浏览器中打开）
    chrome.tabs.create({ url: historyUrl1, active: true });
    
    // 保存 biz 到 storage，以便后续使用
    chrome.storage.local.set({ lastBiz: biz });
    
    showStatus('✓ 已打开历史文章页面。提示：如果页面显示"请在微信客户端打开"，您可以：1) 复制链接在微信中打开，或 2) 等待几秒后直接点击"获取文章列表"尝试提取', 'info');
  } catch (error) {
    showStatus('✗ ' + error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

// 从页面中提取 __biz 参数（注入到页面中执行）
function extractBizFromPage() {
  // 尝试从meta标签中获取
  const metaBiz = document.querySelector('meta[property="og:url"]')?.content;
  if (metaBiz) {
    const match = metaBiz.match(/__biz=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  
  // 尝试从当前URL中获取
  const urlMatch = window.location.href.match(/__biz=([^&]+)/);
  if (urlMatch) return decodeURIComponent(urlMatch[1]);
  
  // 尝试从页面中的链接获取
  const links = document.querySelectorAll('a[href*="__biz"]');
  for (const link of links) {
    const match = link.href.match(/__biz=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  
  return null;
}

// 从页面链接中提取 __biz 参数
function extractBizFromLinks() {
  // 查找所有包含 profile_ext 或 __biz 的链接
  const selectors = [
    'a[href*="profile_ext"]',
    'a[href*="__biz"]',
    '.profile_nickname',
    '.account_nickname'
  ];
  
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      let url = el.href || el.closest('a')?.href;
      if (!url && el.closest('a')) {
        url = el.closest('a').href;
      }
      
      if (url) {
        const match = url.match(/__biz=([^&]+)/);
        if (match) return decodeURIComponent(match[1]);
      }
    }
  }
  
  return null;
}

// 从当前页面提取所有文章链接
async function extractLinksFromCurrentPage() {
  const button = document.getElementById('extractFromCurrentPageBtn');
  button.disabled = true;
  showStatus('正在从当前页面提取链接...', 'info');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('mp.weixin.qq.com')) {
      throw new Error('请在微信公众号文章页面使用此功能');
    }
    
    // 注入脚本提取所有文章链接
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractAllArticleLinks
    });
    
    const data = results[0].result;
    
    if (!data || !data.articles || data.articles.length === 0) {
      throw new Error('未找到文章链接，请确保在微信公众号文章页面使用');
    }
    
    // 显示文章列表
    const accountInfo = document.getElementById('accountInfo');
    const articleList = document.getElementById('articleList');
    
    accountInfo.innerHTML = `
      <div class="account-name">${data.accountName || '公众号'}</div>
      <div class="account-meta">找到 ${data.articles.length} 个文章链接</div>
    `;
    accountInfo.style.display = 'block';
    
    displayArticleList(data.articles);
    articleList.style.display = 'block';
    
    showStatus(`✓ 成功提取 ${data.articles.length} 个文章链接`, 'success');
  } catch (error) {
    showStatus('✗ ' + error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

// 从页面提取所有文章链接（注入到页面中执行）
function extractAllArticleLinks() {
  const articles = [];
  
  // 提取公众号名称
  const accountName = document.querySelector('.profile_nickname')?.textContent.trim() || 
                      document.querySelector('#js_name')?.textContent.trim() ||
                      document.querySelector('.account_nickname_inner')?.textContent.trim() ||
                      '公众号';
  
  // 方法1: 查找所有包含文章链接的a标签
  const allLinks = document.querySelectorAll('a[href*="/s?"], a[href*="/s/"]');
  
  allLinks.forEach(link => {
    try {
      let url = link.href;
      
      // 处理相对路径
      if (url && url.startsWith('/')) {
        url = 'https://mp.weixin.qq.com' + url;
      }
      
      // 确保URL包含完整的域名
      if (url && !url.startsWith('http')) {
        url = 'https://mp.weixin.qq.com' + (url.startsWith('/') ? '' : '/') + url;
      }
      
      // 只添加有效的文章链接
      if (url && (url.includes('/s?') || url.includes('/s/')) && url.includes('mp.weixin.qq.com')) {
        // 尝试提取标题
        const title = link.textContent.trim() || 
                     link.querySelector('h4, .title, .weui-media-box__title, .rich_media_title')?.textContent.trim() ||
                     link.getAttribute('title') ||
                     '未命名文章';
        
        // 避免重复添加
        if (title && !articles.some(a => a.url === url)) {
          articles.push({
            title: title.substring(0, 100), // 限制标题长度
            url: url,
            date: ''
          });
        }
      }
    } catch (e) {
      console.error('提取链接失败:', e);
    }
  });
  
  // 方法2: 查找相关文章区域
  const relatedSelectors = [
    '.related-article',
    '.recommend-article',
    '.more-article',
    '[class*="related"]',
    '[class*="recommend"]'
  ];
  
  relatedSelectors.forEach(selector => {
    const containers = document.querySelectorAll(selector);
    containers.forEach(container => {
      const links = container.querySelectorAll('a[href*="/s"]');
      links.forEach(link => {
        try {
          let url = link.href;
          if (url && url.startsWith('/')) {
            url = 'https://mp.weixin.qq.com' + url;
          }
          if (url && !url.startsWith('http')) {
            url = 'https://mp.weixin.qq.com' + (url.startsWith('/') ? '' : '/') + url;
          }
          if (url && (url.includes('/s?') || url.includes('/s/')) && url.includes('mp.weixin.qq.com')) {
            const title = link.textContent.trim() || link.getAttribute('title') || '未命名文章';
            if (title && !articles.some(a => a.url === url)) {
              articles.push({
                title: title.substring(0, 100),
                url: url,
                date: ''
              });
            }
          }
        } catch (e) {
          console.error('提取相关文章失败:', e);
        }
      });
    });
  });
  
  return {
    accountName,
    articles: articles.slice(0, 100) // 限制最多100个
  };
}

// 获取公众号文章列表
async function fetchAccountArticles() {
  const button = document.getElementById('fetchAccountBtn');
  const loading = document.getElementById('loadingArticles');
  const articleList = document.getElementById('articleList');
  const accountInfo = document.getElementById('accountInfo');
  const historyPageUrlInput = document.getElementById('historyPageUrl');
  
  button.disabled = true;
  loading.style.display = 'block';
  articleList.style.display = 'none';
  accountInfo.style.display = 'none';
  
  try {
    let tab;
    
    // 如果用户输入了历史文章页面链接，使用该链接
    if (historyPageUrlInput && historyPageUrlInput.value.trim()) {
      const url = historyPageUrlInput.value.trim();
      if (!url.includes('mp.weixin.qq.com')) {
        throw new Error('请输入有效的微信公众号链接');
      }
      
      // 打开新标签页
      const newTab = await chrome.tabs.create({ url: url, active: false });
      await sleep(3000); // 等待页面加载
      tab = await chrome.tabs.get(newTab.id);
    } else {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    }
    
    // 检查是否是微信公众号相关页面
    if (!tab.url.includes('mp.weixin.qq.com')) {
      throw new Error('请在微信公众号相关页面使用此功能');
    }
    
    // 如果是历史文章页面，直接提取
    let data = null;
    if (tab.url.includes('mp.weixin.qq.com/mp/profile_ext')) {
      // 注入脚本提取文章列表
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: extractHistoryArticles
      });
      
      data = results[0].result;
    } else {
      // 如果不是历史页面，尝试从当前页面提取（可能是单篇文章页面）
      // 先尝试使用 content.js 中的提取函数
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: extractHistoryArticles
        });
        data = results[0].result;
      } catch (e) {
        // 如果失败，提示用户
        throw new Error('请在公众号历史文章页面使用此功能。如果页面显示"请在微信客户端打开"，请尝试：1) 在微信中打开该链接，或 2) 等待页面完全加载后再试');
      }
    }
    
    if (!data || !data.articles || data.articles.length === 0) {
      // 检查页面是否显示"请在微信客户端打开"
      try {
        const pageCheck = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            const bodyText = document.body.textContent || '';
            if (bodyText.includes('请在微信客户端打开') || bodyText.includes('wechat_redirect')) {
              return { blocked: true };
            }
            return { blocked: false };
          }
        });
        
        if (pageCheck[0].result.blocked) {
          throw new Error('页面显示"请在微信客户端打开链接"。请尝试：1) 复制链接在微信中打开历史文章页面，或 2) 使用单篇转换功能转换当前文章');
        }
      } catch (e) {
        // 忽略检查错误
      }
      
      throw new Error('未找到文章列表。请确保：1) 页面已完全加载，2) 在公众号历史文章页面使用，3) 如果页面显示"请在微信客户端打开"，请在微信中打开该链接');
    }
    
    // 显示公众号信息
    accountInfo.innerHTML = `
      <div class="account-name">${data.accountName || '公众号'}</div>
      <div class="account-meta">找到 ${data.articles.length} 篇文章</div>
    `;
    accountInfo.style.display = 'block';
    
    // 显示文章列表
    displayArticleList(data.articles);
    
    showStatus(`✓ 成功获取 ${data.articles.length} 篇文章`, 'success');
  } catch (error) {
    showStatus('✗ ' + error.message, 'error');
  } finally {
    button.disabled = false;
    loading.style.display = 'none';
  }
}

// 显示文章列表
function displayArticleList(articles) {
  const container = document.getElementById('articleListContent');
  const articleList = document.getElementById('articleList');
  
  container.innerHTML = articles.map((article, index) => `
    <div class="article-item">
      <input type="checkbox" class="article-checkbox" data-index="${index}" checked>
      <div class="article-info">
        <div class="article-title">${article.title}</div>
        <div class="article-meta">${article.date || '日期未知'}</div>
      </div>
    </div>
  `).join('');
  
  articleList.style.display = 'block';
  chrome.storage.local.set({ pendingArticles: articles });
}

// 下载选中的文章
async function downloadSelected() {
  const checkboxes = document.querySelectorAll('.article-checkbox:checked');
  
  if (checkboxes.length === 0) {
    showStatus('请至少选择一篇文章', 'warning');
    return;
  }
  
  const button = document.getElementById('downloadSelectedBtn');
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
}

// 转换URL到Markdown
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

// 提取当前文章内容
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

// 提取历史文章列表
function extractHistoryArticles() {
  const articles = [];
  const accountName = document.querySelector('.profile_nickname')?.textContent.trim() || '';
  
  // 尝试多种选择器来适配不同的页面结构
  const selectors = [
    '.album__list-item',
    '.weui-media-box',
    '[data-type="article"]',
    '.appmsg_item'
  ];
  
  let articleItems = [];
  for (const selector of selectors) {
    articleItems = document.querySelectorAll(selector);
    if (articleItems.length > 0) break;
  }
  
  articleItems.forEach(item => {
    const titleEl = item.querySelector('.album__list-item-title, .weui-media-box__title, .appmsg_title');
    const linkEl = item.querySelector('a');
    const dateEl = item.querySelector('.album__list-item-time, .weui-media-box__info__meta, .appmsg_info');
    
    if (titleEl && linkEl) {
      let url = linkEl.href;
      // 确保URL是完整的
      if (url.startsWith('/')) {
        url = 'https://mp.weixin.qq.com' + url;
      }
      
      // 只添加文章链接
      if (url && (url.includes('/s?') || url.includes('/s/'))) {
        articles.push({
          title: titleEl.textContent.trim(),
          url: url,
          date: dateEl ? dateEl.textContent.trim() : ''
        });
      }
    }
  });
  
  return {
    accountName,
    articles
  };
}

// 工具函数
function showStatus(message, type = 'info') {
  const status = document.getElementById('status');
  if (!status) return;
  
  status.textContent = message;
  status.className = type;
  status.style.display = 'block';
  
  if (type === 'success') {
    setTimeout(() => {
      status.style.display = 'none';
    }, 3000);
  }
}

function showProgress(current, total) {
  const progressSection = document.getElementById('progressSection');
  if (progressSection) {
    progressSection.style.display = 'block';
  }
  updateProgress(current, total);
}

function updateProgress(current, total) {
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  
  if (progressFill && progressText) {
    const percent = Math.round((current / total) * 100);
    progressFill.style.width = percent + '%';
    progressText.textContent = `${current} / ${total} (${percent}%)`;
  }
}

function hideProgress() {
  const progressSection = document.getElementById('progressSection');
  if (progressSection) {
    progressSection.style.display = 'none';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// HTML转Markdown
function convertToMarkdown(article) {
  let markdown = `# ${article.title}\n\n`;
  
  if (article.author) {
    markdown += `**作者**: ${article.author}\n\n`;
  }
  
  if (article.publishTime) {
    markdown += `**发布时间**: ${article.publishTime}\n\n`;
  }
  
  markdown += `**原文链接**: ${article.url}\n\n---\n\n`;
  
  let content = article.content || '';
  
  // 移除script和style标签
  content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // 标题
  content = content.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  content = content.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  content = content.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  content = content.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  
  // 粗体斜体
  content = content.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  content = content.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  content = content.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  
  // 链接
  content = content.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  
  // 图片 - 优先data-src
  content = content.replace(/<img[^>]*data-src=["']([^"']*)["'][^>]*>/gi, '![]($1)\n');
  content = content.replace(/<img[^>]*src=["']([^"']*)["'][^>]*>/gi, '![]($1)\n');
  
  // 段落
  content = content.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  content = content.replace(/<br\s*\/?>/gi, '\n');
  
  // 列表
  content = content.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  
  // 引用
  content = content.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n\n');
  
  // 代码
  content = content.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  
  // 移除所有HTML标签
  content = content.replace(/<[^>]+>/g, '');
  
  // HTML实体解码
  content = content.replace(/&nbsp;/g, ' ');
  content = content.replace(/&lt;/g, '<');
  content = content.replace(/&gt;/g, '>');
  content = content.replace(/&amp;/g, '&');
  content = content.replace(/&quot;/g, '"');
  
  // 清理多余空行
  content = content.replace(/\n{3,}/g, '\n\n');
  
  markdown += content.trim();
  return markdown;
}

// 下载Markdown文件
async function downloadMarkdown(content, filename) {
  filename = filename.replace(/[\\/*?:"<>|]/g, '').substring(0, 100);
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: url,
      filename: `${filename}.md`,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve(downloadId);
      }
    });
  });
}