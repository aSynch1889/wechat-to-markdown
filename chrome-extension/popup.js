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
    
    if (!tab.url.includes('mp.weixin.qq.com/s')) {
      throw new Error('请在微信公众号文章页面使用此功能');
    }
    
    // 从当前文章URL提取__biz参数
    const bizMatch = tab.url.match(/__biz=([^&]+)/);
    if (!bizMatch) {
      throw new Error('无法提取公众号信息');
    }
    
    const biz = bizMatch[1];
    const historyUrl = `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${biz}&scene=124#wechat_redirect`;
    
    // 打开历史页面
    chrome.tabs.create({ url: historyUrl, active: true });
    
    showStatus('✓ 已打开历史文章页面，请等待加载完成后点击"获取文章列表"', 'success');
  } catch (error) {
    showStatus('✗ ' + error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

// 获取公众号文章列表
async function fetchAccountArticles() {
  const button = document.getElementById('fetchAccountBtn');
  const loading = document.getElementById('loadingArticles');
  const articleList = document.getElementById('articleList');
  const accountInfo = document.getElementById('accountInfo');
  
  button.disabled = true;
  loading.style.display = 'block';
  articleList.style.display = 'none';
  accountInfo.style.display = 'none';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // 检查是否是历史消息页面
    if (!tab.url.includes('mp.weixin.qq.com/mp/profile_ext')) {
      throw new Error('请先打开公众号历史文章页面');
    }
    
    // 注入脚本提取文章列表
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractHistoryArticles
    });
    
    const data = results[0].result;
    
    if (!data || !data.articles || data.articles.length === 0) {
      throw new Error('未找到文章列表，请确保页面已完全加载');
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