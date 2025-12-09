chrome.runtime.onInstalled.addListener(() => {
    console.log('微信转Markdown扩展已安装');
  });
  
  chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current === 'complete') {
      console.log('文件下载完成');
    }
  });
  
  // HTML转Markdown
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
  
  // 下载Markdown
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
  
  // 工具函数
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // 监听来自popup或content script的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'convertToMarkdown') {
      try {
        const markdown = convertToMarkdown(request.article);
        sendResponse({ success: true, markdown });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return true; // 保持消息通道开启
    }
    
    if (request.action === 'downloadMarkdown') {
      downloadMarkdown(request.content, request.filename)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          sendResponse({ success: false, error: error.message });
        });
      return true; // 保持消息通道开启
    }
    
    return false; // 未处理的消息
  });