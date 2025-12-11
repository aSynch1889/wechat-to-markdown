// 在公众号后台页面注入的内容脚本

console.log('微信公众号后台内容脚本已加载');

// 拦截XMLHttpRequest
(function() {
  const originalXHR = window.XMLHttpRequest;
  
  function newXHR() {
    const xhr = new originalXHR();
    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    
    xhr.open = function(method, url) {
      this._url = url;
      return originalOpen.apply(this, arguments);
    };
    
    xhr.send = function() {
      this.addEventListener('load', function() {
        // 拦截文章列表API
        if (this._url && this._url.includes('/cgi-bin/appmsg')) {
          try {
            const data = JSON.parse(this.responseText);
            console.log('检测到文章列表API调用:', data);
            
            // 发送到扩展
            chrome.runtime.sendMessage({
              type: 'MP_ARTICLES_DETECTED',
              data: data
            });
          } catch (error) {
            console.error('解析API响应失败:', error);
          }
        }
      });
      
      return originalSend.apply(this, arguments);
    };
    
    return xhr;
  }
  
  window.XMLHttpRequest = newXHR;
})();

// 拦截Fetch API
(function() {
  const originalFetch = window.fetch;
  
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    
    // 检查是否是文章API
    if (args[0] && typeof args[0] === 'string' && args[0].includes('/cgi-bin/appmsg')) {
      const clonedResponse = response.clone();
      
      try {
        const data = await clonedResponse.json();
        console.log('检测到文章列表API调用(fetch):', data);
        
        chrome.runtime.sendMessage({
          type: 'MP_ARTICLES_DETECTED',
          data: data
        });
      } catch (error) {
        console.error('解析Fetch响应失败:', error);
      }
    }
    
    return response;
  };
})();

// 页面加载完成后的处理
window.addEventListener('load', () => {
  console.log('公众号后台页面加载完成');
  
  // 检测是否已登录
  const isLoggedIn = document.querySelector('.weui-desktop-menu__item') !== null;
  
  if (isLoggedIn) {
    console.log('已登录公众号后台');
    
    // 通知扩展
    chrome.runtime.sendMessage({
      type: 'MP_LOGIN_DETECTED',
      loggedIn: true
    });
  }
});