document.getElementById('convertBtn').addEventListener('click', async () => {
    const button = document.getElementById('convertBtn');
    const status = document.getElementById('status');
    
    button.disabled = true;
    button.textContent = '转换中...';
    status.style.display = 'block';
    status.className = 'info';
    status.textContent = '正在提取文章内容...';
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // 检查是否是微信公众号页面
      if (!tab.url.includes('mp.weixin.qq.com')) {
        throw new Error('请在微信公众号文章页面使用此扩展');
      }
      
      // 注入内容脚本
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: extractArticle
      });
      
      const article = results[0].result;
      
      if (!article) {
        throw new Error('未能提取文章内容');
      }
      
      // 转换为Markdown
      const markdown = convertToMarkdown(article);
      
      // 下载文件
      downloadMarkdown(markdown, article.title);
      
      status.className = 'success';
      status.textContent = '✓ 转换成功！文件已下载';
      
    } catch (error) {
      status.className = 'error';
      status.textContent = '✗ ' + error.message;
    } finally {
      button.disabled = false;
      button.textContent = '转换当前页面';
    }
  });
  
  // 在页面中提取文章内容
  function extractArticle() {
    const article = {
      title: '',
      author: '',
      publishTime: '',
      content: ''
    };
    
    // 提取标题
    const titleEl = document.querySelector('.rich_media_title');
    if (titleEl) {
      article.title = titleEl.textContent.trim();
    }
    
    // 提取作者
    const authorEl = document.querySelector('#js_name');
    if (authorEl) {
      article.author = authorEl.textContent.trim();
    }
    
    // 提取发布时间
    const timeEl = document.querySelector('#publish_time');
    if (timeEl) {
      article.publishTime = timeEl.textContent.trim();
    }
    
    // 提取正文
    const contentEl = document.querySelector('#js_content');
    if (contentEl) {
      article.content = contentEl.innerHTML;
    }
    
    return article;
  }
  
  // 转换为Markdown
  function convertToMarkdown(article) {
    let markdown = `# ${article.title}\n\n`;
    
    if (article.author) {
      markdown += `**作者**: ${article.author}\n\n`;
    }
    
    if (article.publishTime) {
      markdown += `**发布时间**: ${article.publishTime}\n\n`;
    }
    
    markdown += '---\n\n';
    
    // 转换HTML内容
    let content = article.content;
    
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
  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    // 清理文件名
    filename = filename.replace(/[\\/*?:"<>|]/g, '');
    
    chrome.downloads.download({
      url: url,
      filename: `${filename}.md`,
      saveAs: true
    });
  }
  