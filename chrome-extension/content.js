// content.js - 在公众号历史消息页面注入的内容脚本
console.log('微信公众号转Markdown扩展 - 内容脚本已加载');

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractArticles') {
    try {
      const data = extractHistoryArticles();
      sendResponse({ success: true, data });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
  return true; // 保持消息通道开启
});

// 提取历史文章列表
function extractHistoryArticles() {
  const articles = [];
  
  // 提取公众号名称
  const accountName = document.querySelector('.profile_nickname')?.textContent.trim() || 
                      document.querySelector('.account_nickname_inner')?.textContent.trim() ||
                      '公众号';
  
  console.log('正在查找文章列表...');
  
  // 尝试多种选择器来适配不同的页面结构
  const selectors = [
    // 新版页面选择器
    '.album__list-item',
    '.album_li_item',
    // WeUI组件选择器
    '.weui-media-box',
    '.weui-media-box__appmsg',
    // 数据属性选择器
    '[data-type="article"]',
    '[data-type="appmsg"]',
    // 通用文章选择器
    '.appmsg_item',
    '.appmsgitem',
    // 消息列表选择器
    '.msg_item',
    '.weui_msg_card'
  ];
  
  let articleItems = [];
  let usedSelector = '';
  
  // 尝试所有选择器，找到第一个有结果的
  for (const selector of selectors) {
    articleItems = document.querySelectorAll(selector);
    if (articleItems.length > 0) {
      usedSelector = selector;
      console.log(`使用选择器: ${selector}, 找到 ${articleItems.length} 个元素`);
      break;
    }
  }
  
  if (articleItems.length === 0) {
    console.warn('未找到文章列表，尝试直接查找链接...');
    // 备用方案：直接查找所有包含文章链接的a标签
    const links = document.querySelectorAll('a[href*="/s?"], a[href*="/s/"]');
    links.forEach(link => {
      const title = link.textContent.trim() || 
                   link.querySelector('h4, .title, .weui-media-box__title')?.textContent.trim();
      if (title && title.length > 0) {
        articleItems = Array.from(links).map(l => l.closest('div, li'));
        break;
      }
    });
  }
  
  console.log(`开始解析 ${articleItems.length} 个文章元素`);
  
  // 解析每个文章元素
  articleItems.forEach((item, index) => {
    try {
      // 尝试多种方式找到标题
      const titleEl = item.querySelector('.album__list-item-title') ||
                     item.querySelector('.weui-media-box__title') ||
                     item.querySelector('.appmsg_title') ||
                     item.querySelector('h4') ||
                     item.querySelector('.title') ||
                     item.querySelector('[class*="title"]');
      
      // 尝试多种方式找到链接
      const linkEl = item.querySelector('a') ||
                    item.closest('a') ||
                    item.querySelector('[href*="/s"]');
      
      // 尝试多种方式找到日期
      const dateEl = item.querySelector('.album__list-item-time') ||
                    item.querySelector('.weui-media-box__info__meta') ||
                    item.querySelector('.appmsg_info') ||
                    item.querySelector('.publish_time') ||
                    item.querySelector('[class*="time"]') ||
                    item.querySelector('[class*="date"]');
      
      if (titleEl && linkEl) {
        let url = linkEl.href;
        
        // 处理相对路径
        if (url && url.startsWith('/')) {
          url = 'https://mp.weixin.qq.com' + url;
        }
        
        // 确保URL包含完整的域名
        if (url && !url.startsWith('http')) {
          url = 'https://mp.weixin.qq.com' + (url.startsWith('/') ? '' : '/') + url;
        }
        
        // 只添加有效的文章链接
        if (url && (url.includes('/s?') || url.includes('/s/'))) {
          const title = titleEl.textContent.trim();
          const date = dateEl ? dateEl.textContent.trim() : '';
          
          // 避免重复添加
          if (title && !articles.some(a => a.url === url)) {
            articles.push({
              title: title,
              url: url,
              date: date,
              index: index
            });
            
            console.log(`找到文章 ${articles.length}: ${title.substring(0, 30)}...`);
          }
        }
      }
    } catch (error) {
      console.error(`解析第 ${index} 个元素时出错:`, error);
    }
  });
  
  console.log(`✓ 成功提取 ${articles.length} 篇文章`);
  
  // 如果还是没找到文章，返回错误信息
  if (articles.length === 0) {
    const pageHtml = document.body.innerHTML;
    console.error('页面HTML预览:', pageHtml.substring(0, 500));
    throw new Error('未找到文章列表，请确保页面已完全加载');
  }
  
  return {
    accountName: accountName,
    articles: articles,
    selector: usedSelector,
    timestamp: new Date().toISOString()
  };
}

// 页面加载完成后的处理
window.addEventListener('load', () => {
  console.log('页面加载完成');
  
  // 尝试自动检测文章列表
  setTimeout(() => {
    try {
      const result = extractHistoryArticles();
      console.log(`自动检测: 找到 ${result.articles.length} 篇文章`);
      
      // 可以在页面上显示提示
      if (result.articles.length > 0) {
        showNotification(`已检测到 ${result.articles.length} 篇文章，可以使用扩展获取`);
      }
    } catch (error) {
      console.log('自动检测文章失败:', error.message);
    }
  }, 3000); // 等待3秒确保内容加载
});

// 监听页面滚动，支持懒加载
let scrollTimeout;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    console.log('检测到滚动，可能有新内容加载');
  }, 1000);
});

// 在页面显示通知（可选）
function showNotification(message) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #10b981;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    z-index: 999999;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    animation: slideIn 0.3s ease-out;
  `;
  
  notification.textContent = '✓ ' + message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// 添加样式
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// 监听DOM变化（检测动态加载的内容）
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.addedNodes.length > 0) {
      console.log('检测到DOM变化，可能有新文章加载');
    }
  });
});

// 开始观察文档变化
observer.observe(document.body, {
  childList: true,
  subtree: true
});

console.log('✓ 内容脚本初始化完成，准备提取文章列表');