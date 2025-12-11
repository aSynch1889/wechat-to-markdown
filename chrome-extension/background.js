// Service Worker后台脚本

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'searchMPArticles') {
    searchMPArticles(request.accountName, request.credentials)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道开启
  }
});

// 搜索公众号文章
async function searchMPArticles(accountName, credentials) {
  try {
    // 第一步：搜索公众号，获取fakeid
    const fakeid = await searchAccount(accountName, credentials);
    
    if (!fakeid) {
      throw new Error('未找到该公众号');
    }
    
    // 第二步：获取文章列表
    const articles = await getArticleList(fakeid, credentials);
    
    return {
      success: true,
      articles: articles
    };
  } catch (error) {
    console.error('搜索文章失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 搜索公众号获取fakeid
async function searchAccount(accountName, credentials) {
  const url = 'https://mp.weixin.qq.com/cgi-bin/searchbiz';
  
  const params = new URLSearchParams({
    action: 'search_biz',
    query: accountName,
    token: credentials.token,
    lang: 'zh_CN',
    f: 'json',
    ajax: '1'
  });
  
  try {
    const response = await fetch(`${url}?${params}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://mp.weixin.qq.com/',
        'Cookie': buildCookieString(credentials.cookies)
      },
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (data.base_resp && data.base_resp.ret === 0) {
      // 返回第一个匹配的公众号的fakeid
      if (data.list && data.list.length > 0) {
        return data.list[0].fakeid;
      }
    }
    
    return null;
  } catch (error) {
    console.error('搜索公众号失败:', error);
    throw error;
  }
}

// 获取文章列表
async function getArticleList(fakeid, credentials, begin = 0, count = 20) {
  const url = 'https://mp.weixin.qq.com/cgi-bin/appmsg';
  
  const params = new URLSearchParams({
    action: 'list_ex',
    begin: begin.toString(),
    count: count.toString(),
    fakeid: fakeid,
    type: '9',
    token: credentials.token,
    lang: 'zh_CN',
    f: 'json',
    ajax: '1'
  });
  
  try {
    const response = await fetch(`${url}?${params}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://mp.weixin.qq.com/',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': buildCookieString(credentials.cookies)
      },
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (data.base_resp && data.base_resp.ret === 0) {
      return data.app_msg_list.map(article => ({
        title: article.title,
        url: article.link,
        date: formatDate(article.update_time),
        author: article.author || '',
        digest: article.digest || ''
      }));
    } else {
      throw new Error('API返回错误: ' + (data.base_resp?.err_msg || '未知错误'));
    }
  } catch (error) {
    console.error('获取文章列表失败:', error);
    throw error;
  }
}

// 构建Cookie字符串
function buildCookieString(cookies) {
  if (!cookies || !Array.isArray(cookies)) {
    return '';
  }
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

// 格式化日期
function formatDate(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

// 下载完成监听
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === 'complete') {
    console.log('文件下载完成');
  }
});