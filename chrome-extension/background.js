// Service Worker后台脚本

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'searchMPArticles') {
    searchMPArticles(request.accountName, request.credentials)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道开启
  }
  
  if (request.action === 'downloadArticles') {
    downloadArticles(request.articles, request.credentials)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道开启
  }
  
  if (request.action === 'getDownloadProgress') {
    chrome.storage.local.get('downloadProgress', (data) => {
      sendResponse(data.downloadProgress || { current: 0, total: 0, status: 'idle' });
    });
    return true;
  }
  
  if (request.action === 'getSearchProgress') {
    chrome.storage.local.get(['searchProgress', 'searchArticles'], (data) => {
      sendResponse({
        progress: data.searchProgress || null,
        articles: data.searchArticles || []
      });
    });
    return true;
  }
  
  if (request.action === 'cancelSearch') {
    chrome.storage.local.set({
      searchCancelled: true
    });
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'getCachedArticles') {
    const cacheKey = `mpCache_${request.accountName}`;
    chrome.storage.local.get(cacheKey, (data) => {
      sendResponse(data[cacheKey] || null);
    });
    return true;
  }
});

// 搜索公众号文章
async function searchMPArticles(accountName, credentials) {
  try {
    // 清除取消标志
    await chrome.storage.local.remove('searchCancelled');
    
    // 检查缓存
    const cacheKey = `mpCache_${accountName}`;
    const cacheData = await chrome.storage.local.get(cacheKey);
    const cached = cacheData[cacheKey];
    
    // 缓存有效期：24小时
    const CACHE_EXPIRY = 24 * 60 * 60 * 1000;
    if (cached && cached.timestamp && (Date.now() - cached.timestamp < CACHE_EXPIRY)) {
      console.log('使用缓存数据，文章数量:', cached.articles.length);
      return {
        success: true,
        articles: cached.articles,
        fromCache: true
      };
    }
    
    // 初始化搜索进度和文章列表
    await chrome.storage.local.set({
      searchProgress: {
        status: 'searching',
        current: 0,
        total: 0,
        message: '正在搜索公众号...'
      },
      searchArticles: []
    });
    
    // 第一步：搜索公众号，获取fakeid
    const fakeid = await searchAccount(accountName, credentials);
    
    if (!fakeid) {
      await chrome.storage.local.set({
        searchProgress: {
          status: 'error',
          message: '未找到该公众号'
        }
      });
      throw new Error('未找到该公众号');
    }
    
    // 检查是否取消
    const cancelled = await chrome.storage.local.get('searchCancelled');
    if (cancelled.searchCancelled) {
      throw new Error('搜索已取消');
    }
    
    // 第二步：获取所有文章列表（分页获取，0表示获取全部）
    console.log('开始获取文章列表，fakeid:', fakeid);
    
    await chrome.storage.local.set({
      searchProgress: {
        status: 'fetching',
        current: 0,
        total: 0,
        message: '正在获取文章列表...'
      }
    });
    
    const articles = await getAllArticles(fakeid, credentials, 0, accountName);
    console.log('文章获取完成，共获取:', articles.length, '篇文章');
    
    // 保存到缓存
    await chrome.storage.local.set({
      [cacheKey]: {
        articles: articles,
        accountName: accountName,
        fakeid: fakeid,
        timestamp: Date.now()
      }
    });
    
    // 清除搜索进度和临时文章列表
    await chrome.storage.local.remove(['searchProgress', 'searchArticles']);
    
    return {
      success: true,
      articles: articles
    };
  } catch (error) {
    console.error('搜索文章失败:', error);
    await chrome.storage.local.set({
      searchProgress: {
        status: 'error',
        message: error.message
      }
    });
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

// 获取文章列表（支持分页）
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
    
    console.log('API返回数据:', {
      ret: data.base_resp?.ret,
      app_msg_list_length: data.app_msg_list?.length,
      app_msg_cnt: data.app_msg_cnt,
      begin: begin,
      count: count
    });
    
    if (data.base_resp && data.base_resp.ret === 0) {
      const articles = (data.app_msg_list || []).map(article => ({
        title: article.title,
        url: article.link,
        date: formatDate(article.update_time),
        author: article.author || '',
        digest: article.digest || ''
      }));
      
      const total = data.app_msg_cnt || 0;
      const currentCount = articles.length;
      const nextBegin = begin + currentCount;
      
      // 改进的判断逻辑：更保守地判断是否还有更多文章
      // 1. 如果返回的文章数等于请求的数量，说明可能还有更多（继续尝试）
      // 2. 如果有总数信息，且下一页起始位置小于总数，说明还有更多
      // 3. 即使有总数信息，如果返回了满页数据，也继续尝试（因为总数可能不准确）
      // 4. 只有当返回的文章数少于请求数时，才确定没有更多了
      let hasMore = false;
      if (currentCount === count) {
        // 返回了满页数据，继续尝试获取下一页
        // 即使有总数信息，也继续尝试，因为总数可能不准确
        hasMore = true;
      } else if (currentCount > 0) {
        // 返回了部分数据（少于请求数），但还有数据
        // 如果有总数信息，检查是否还有更多
        if (total > 0) {
          hasMore = nextBegin < total;
        } else {
          // 没有总数信息，但还有数据返回，继续尝试
          hasMore = true;
        }
      } else {
        // 返回的文章数为0，确定没有更多了
        hasMore = false;
      }
      
      console.log(`获取文章列表: begin=${begin}, count=${count}, 返回=${currentCount}, 总数=${total}, 还有更多=${hasMore}, nextBegin=${nextBegin}`);
      
      return {
        articles: articles,
        total: total,
        hasMore: hasMore,
        nextBegin: nextBegin
      };
    } else {
      console.error('API返回错误:', data.base_resp);
      throw new Error('API返回错误: ' + (data.base_resp?.err_msg || '未知错误'));
    }
  } catch (error) {
    console.error('获取文章列表失败:', error);
    throw error;
  }
}

// 获取所有文章（分页获取）
async function getAllArticles(fakeid, credentials, maxCount = 0, accountName = '') {
  const allArticles = [];
  let begin = 0;
  const pageSize = 20; // 每页20条
  let hasMore = true;
  let totalCount = 0;
  let pageNum = 0;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 5; // 增加最多连续错误次数到5次
  let lastArticleCount = 0; // 记录上一页获取的文章数
  let noProgressCount = 0; // 记录连续没有进展的次数
  let lastFreqControlError = false; // 记录是否最近遇到频率控制错误
  
  console.log(`开始获取文章列表，maxCount=${maxCount === 0 ? '全部' : maxCount}`);
  
  while (hasMore && (maxCount === 0 || allArticles.length < maxCount)) {
    // 检查是否取消
    const cancelled = await chrome.storage.local.get('searchCancelled');
    if (cancelled.searchCancelled) {
      console.log('搜索已取消，停止获取');
      // 保存已获取的文章到缓存（即使未完成）
      if (accountName && allArticles.length > 0) {
        const cacheKey = `mpCache_${accountName}`;
        await chrome.storage.local.set({
          [cacheKey]: {
            articles: allArticles,
            accountName: accountName,
            fakeid: fakeid,
            timestamp: Date.now(),
            incomplete: true // 标记为未完成
          }
        });
      }
      throw new Error('搜索已取消');
    }
    
    pageNum++;
    try {
      const result = await getArticleList(fakeid, credentials, begin, pageSize);
      
      if (result.articles && result.articles.length > 0) {
        allArticles.push(...result.articles);
        totalCount = result.total || allArticles.length;
        hasMore = result.hasMore;
        begin = result.nextBegin || (begin + result.articles.length);
        consecutiveErrors = 0; // 重置错误计数
        
        // 如果之前遇到频率控制错误，成功获取后仍然保持较长的延迟
        // 但逐渐恢复正常延迟（每成功获取一页，延迟时间减半，直到恢复正常）
        
        // 检查是否有进展
        if (result.articles.length === lastArticleCount && lastArticleCount === pageSize) {
          noProgressCount++;
        } else {
          noProgressCount = 0;
        }
        lastArticleCount = result.articles.length;
        
        console.log(`第 ${pageNum} 页: 获取 ${result.articles.length} 篇文章，累计 ${allArticles.length} 篇，总数 ${totalCount}, hasMore=${hasMore}`);
        
        // 更新搜索进度和已获取的文章列表（增量更新）
        await chrome.storage.local.set({
          searchProgress: {
            status: 'fetching',
            current: allArticles.length,
            total: totalCount > 0 ? totalCount : allArticles.length,
            page: pageNum,
            message: `正在获取第 ${pageNum} 页，已获取 ${allArticles.length} 篇文章${totalCount > 0 ? ` / 共 ${totalCount} 篇` : ''}`
          },
          searchArticles: allArticles // 实时保存已获取的文章
        });
        
        // 如果设置了最大数量限制，检查是否达到
        if (maxCount > 0 && allArticles.length >= maxCount) {
          console.log(`已达到最大数量限制 ${maxCount}，停止获取`);
          break;
        }
        
        // 如果连续多次返回相同数量的满页数据，可能是API限制，尝试继续但记录警告
        if (noProgressCount >= 3) {
          console.warn(`连续 ${noProgressCount} 次返回相同数量的满页数据，可能遇到API限制，继续尝试...`);
        }
        
        // 如果返回的文章数为0，说明没有更多了
        if (result.articles.length === 0) {
          console.log('返回文章数为0，停止获取');
          hasMore = false;
          break;
        }
        
        // 避免请求过快 - 根据页数和是否遇到频率控制错误动态调整延迟
        if (hasMore) {
          let delay = 1500; // 默认1.5秒
          
          // 如果最近遇到频率控制错误，使用更长的延迟
          if (lastFreqControlError) {
            delay = 5000; // 频率控制错误后，延迟5秒
            lastFreqControlError = false; // 重置标志，下次恢复正常延迟
            console.log('频率控制错误后恢复，使用较长延迟');
          } else {
            // 根据页数动态调整延迟
            if (pageNum > 30) {
              delay = 3000; // 30页以上延迟3秒
            } else if (pageNum > 10) {
              delay = 2000; // 10-30页延迟2秒
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } else {
        // 返回空列表，说明没有更多了
        console.log('返回空列表，停止获取');
        hasMore = false;
        break;
      }
    } catch (error) {
      consecutiveErrors++;
      const errorMessage = error.message || '';
      const isFreqControl = errorMessage.includes('freq control') || errorMessage.includes('频率');
      
      console.error(`获取第 ${pageNum} 页失败 (连续错误 ${consecutiveErrors}/${maxConsecutiveErrors}):`, error);
      
      // 如果是频率控制错误，标记并使用更长的等待时间和指数退避策略
      if (isFreqControl) {
        lastFreqControlError = true; // 标记遇到了频率控制错误
        // 指数退避：第1次错误等待5秒，第2次10秒，第3次20秒，以此类推
        const backoffDelay = Math.min(5000 * Math.pow(2, consecutiveErrors - 1), 60000); // 最多60秒
        console.warn(`检测到频率限制，等待 ${backoffDelay / 1000} 秒后重试...`);
        
        // 更新进度提示
        await chrome.storage.local.set({
          searchProgress: {
            status: 'fetching',
            current: allArticles.length,
            total: totalCount > 0 ? totalCount : allArticles.length,
            page: pageNum,
            message: `遇到频率限制，等待 ${Math.round(backoffDelay / 1000)} 秒后继续...`
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      } else {
        // 其他错误，等待3秒后重试
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // 如果连续错误次数过多，停止获取
      if (consecutiveErrors >= maxConsecutiveErrors) {
        console.error('连续错误次数过多，停止获取');
        if (isFreqControl) {
          console.error('由于频率限制，建议稍后再试');
        }
        break;
      }
    }
  }
  
  console.log(`文章获取完成: 共获取 ${allArticles.length} 篇文章`);
  
  // 更新最终进度
  await chrome.storage.local.set({
    searchProgress: {
      status: 'completed',
      current: allArticles.length,
      total: allArticles.length,
      message: `获取完成，共 ${allArticles.length} 篇文章`
    }
  });
  
  return allArticles;
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

// 尝试直接通过fetch获取文章内容（类似wechat-article-exporter的方式）
// 注意：在Chrome扩展的Service Worker中，由于CORS限制，这种方式通常会失败
// 但保留此函数以便将来可能的使用场景（如offscreen document）
async function fetchArticleContentDirect(url, credentials) {
  try {
    console.log('尝试直接fetch获取文章内容:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://mp.weixin.qq.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cookie': buildCookieString(credentials.cookies)
      },
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    return parseArticleFromHTML(html, url);
  } catch (error) {
    // CORS错误或其他错误，记录并抛出
    const isCorsError = error.message.includes('CORS') || 
                       error.message.includes('Access-Control-Allow-Origin') ||
                       error.name === 'TypeError';
    
    if (isCorsError) {
      console.log('CORS限制：直接fetch不可用，将使用标签页方式');
    } else {
      console.log('直接fetch失败:', error.message);
    }
    throw error; // 抛出错误，让调用者使用标签页方式
  }
}

// 从HTML中解析文章内容（使用正则表达式，兼容Service Worker）
function parseArticleFromHTML(html, url) {
  const article = {
    title: '',
    author: '',
    publishTime: '',
    content: '',
    url: url
  };
  
  // 提取标题 - 尝试多种选择器
  const titlePatterns = [
    /<h1[^>]*class=["'][^"']*rich_media_title[^"']*["'][^>]*>(.*?)<\/h1>/is,
    /<h1[^>]*id=["']activity-name["'][^>]*>(.*?)<\/h1>/is,
    /<h1[^>]*>(.*?)<\/h1>/is,
    /<title>(.*?)<\/title>/is
  ];
  
  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      article.title = match[1].replace(/<[^>]+>/g, '').trim();
      if (article.title) break;
    }
  }
  
  // 提取作者
  const authorPatterns = [
    /<a[^>]*id=["']js_name["'][^>]*>(.*?)<\/a>/is,
    /<strong[^>]*class=["'][^"']*rich_media_meta_text[^"']*["'][^>]*>(.*?)<\/strong>/is,
    /<span[^>]*class=["'][^"']*profile_nickname[^"']*["'][^>]*>(.*?)<\/span>/is
  ];
  
  for (const pattern of authorPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      article.author = match[1].replace(/<[^>]+>/g, '').trim();
      if (article.author) break;
    }
  }
  
  // 提取发布时间
  const timePatterns = [
    /<em[^>]*id=["']publish_time["'][^>]*>(.*?)<\/em>/is,
    /<span[^>]*class=["'][^"']*publish_time[^"']*["'][^>]*>(.*?)<\/span>/is
  ];
  
  for (const pattern of timePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      article.publishTime = match[1].replace(/<[^>]+>/g, '').trim();
      if (article.publishTime) break;
    }
  }
  
  // 提取正文内容
  const contentPatterns = [
    /<div[^>]*id=["']js_content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*rich_media_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  ];
  
  for (const pattern of contentPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      article.content = match[1];
      break;
    }
  }
  
  if (!article.content) {
    throw new Error('未找到文章正文内容');
  }
  
  if (!article.title) {
    article.title = '未命名文章';
  }
  
  return article;
}

// 使用隐藏标签页获取文章内容（无头模式，避免CORS）- 作为备用方案
async function fetchArticleContentWithTab(url) {
  return new Promise((resolve, reject) => {
    // 创建隐藏标签页（active: false 表示不在前台显示）
    chrome.tabs.create({ url: url, active: false }, async (tab) => {
      try {
        // 等待页面加载
        await waitForTabReady(tab.id);
        
        // 注入脚本提取文章内容
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: extractArticle
        });
        
        const article = results[0].result;
        if (!article || !article.title) {
          throw new Error('未能提取文章内容');
        }
        
        // 关闭标签页
        chrome.tabs.remove(tab.id).catch(() => {});
        
        resolve(article);
      } catch (error) {
        // 确保关闭标签页
        chrome.tabs.remove(tab.id).catch(() => {});
        console.error('获取文章内容失败:', error);
        reject(error);
      }
    });
  });
}

// 统一的文章内容获取函数
// 注意：由于Chrome扩展Service Worker的CORS限制，直接fetch会失败
// 因此直接使用标签页方式（这是最可靠的方法）
async function fetchArticleContent(url, credentials = null) {
  // 在Chrome扩展的Service Worker中，由于CORS限制，直接fetch无法工作
  // wechat-article-exporter 项目可能是在服务器端运行，所以不受CORS限制
  // 我们直接使用标签页方式，这是最可靠的方法
  
  // 如果将来需要使用直接fetch，可以考虑：
  // 1. 使用 offscreen document (Chrome 109+)
  // 2. 在服务器端运行（类似wechat-article-exporter）
  // 3. 使用 chrome.webRequest API（需要更多权限）
  
  return await fetchArticleContentWithTab(url);
  
  // 以下代码保留，供将来可能的使用场景
  /*
  if (credentials && credentials.cookies && credentials.cookies.length > 0) {
    try {
      return await fetchArticleContentDirect(url, credentials);
    } catch (error) {
      console.log('直接fetch失败（预期行为，CORS限制），使用标签页方式');
      return await fetchArticleContentWithTab(url);
    }
  } else {
    return await fetchArticleContentWithTab(url);
  }
  */
}

// 等待标签页加载完成
function waitForTabReady(tabId, maxWait = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let contentReady = false;
    
    const checkContent = () => {
      // 检查是否超时
      if (Date.now() - startTime > maxWait) {
        reject(new Error('页面加载超时'));
        return;
      }
      
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: () => {
          // 检查关键元素是否存在
          const contentEl = document.querySelector('#js_content');
          const titleEl = document.querySelector('.rich_media_title, #activity-name');
          return {
            hasContent: !!contentEl,
            hasTitle: !!titleEl,
            ready: !!(contentEl && titleEl && contentEl.innerHTML.trim().length > 100)
          };
        }
      }, (results) => {
        if (chrome.runtime.lastError) {
          // 如果注入失败，可能是页面还没准备好，继续等待
          setTimeout(() => {
            chrome.tabs.get(tabId, (tab) => {
              if (chrome.runtime.lastError) {
                reject(new Error('标签页已关闭或不存在'));
                return;
              }
              if (tab.status === 'complete') {
                checkContent();
              } else {
                setTimeout(checkContent, 1000);
              }
            });
          }, 1000);
          return;
        }
        
        if (results && results[0] && results[0].result) {
          const check = results[0].result;
          if (check.ready) {
            contentReady = true;
            // 内容已准备好，再等待1秒确保完全加载
            setTimeout(resolve, 1000);
          } else {
            // 内容还没准备好，继续等待
            setTimeout(checkContent, 1000);
          }
        } else {
          setTimeout(checkContent, 1000);
        }
      });
    };
    
    const checkTab = () => {
      chrome.tabs.get(tabId, (tab) => {
        // 检查是否有错误
        if (chrome.runtime.lastError) {
          reject(new Error('标签页已关闭或不存在'));
          return;
        }
        
        // 检查是否超时
        if (Date.now() - startTime > maxWait) {
          reject(new Error('页面加载超时'));
          return;
        }
        
        // 检查标签页状态
        if (tab.status === 'complete' && tab.url && !tab.url.includes('chrome-error://')) {
          // 页面加载完成，开始检查内容
          if (!contentReady) {
            // 等待一下再检查内容，给页面一些时间渲染
            setTimeout(checkContent, 2000);
          }
        } else {
          // 页面还在加载中，继续检查
          setTimeout(checkTab, 500);
        }
      });
    };
    
    // 立即检查一次
    checkTab();
  });
}

// 提取文章内容的函数（将在页面上下文中执行）
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
  
  if (!article.title) {
    const titleTag = document.querySelector('title');
    if (titleTag) article.title = titleTag.textContent.trim();
  }
  
  if (!article.title) {
    article.title = '未命名文章';
  }
  
  return article;
}


// 将文章转换为Markdown
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

// 下载Markdown文件（使用data URL，兼容Service Worker）
async function downloadMarkdown(content, filename) {
  filename = filename.replace(/[\\/*?:"<>|]/g, '').substring(0, 100);
  
  // 在Service Worker中，使用data URL而不是Blob URL
  const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(content);
  
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: `${filename}.md`,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

// 并发下载文章（限制并发数）
async function downloadArticles(articles, credentials, maxConcurrent = 3) {
  const total = articles.length;
  let completed = 0;
  let successCount = 0;
  let failCount = 0;
  
  // 更新进度
  const updateProgress = async () => {
    await chrome.storage.local.set({
      downloadProgress: {
        current: completed,
        total: total,
        status: 'downloading',
        success: successCount,
        failed: failCount
      }
    });
  };
  
  // 初始化进度
  await updateProgress();
  
  // 下载单个文章
  const downloadSingleArticle = async (article) => {
    try {
      // 传递凭证信息，优先使用直接fetch方式
      const articleData = await fetchArticleContent(article.url, credentials);
      const markdown = convertToMarkdown(articleData);
      await downloadMarkdown(markdown, articleData.title);
      successCount++;
      return { success: true, article: article.title };
    } catch (error) {
      failCount++;
      console.error(`下载失败: ${article.title}`, error);
      return { success: false, article: article.title, error: error.message };
    } finally {
      completed++;
      await updateProgress();
    }
  };
  
  // 并发控制：分批下载
  const results = [];
  for (let i = 0; i < articles.length; i += maxConcurrent) {
    const batch = articles.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(article => downloadSingleArticle(article))
    );
    results.push(...batchResults);
    
    // 批次之间稍作延迟，避免请求过快
    if (i + maxConcurrent < articles.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // 完成
  await chrome.storage.local.set({
    downloadProgress: {
      current: total,
      total: total,
      status: 'completed',
      success: successCount,
      failed: failCount
    }
  });
  
  return {
    success: true,
    total: total,
    successCount: successCount,
    failCount: failCount,
    results: results
  };
}

// 下载完成监听
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === 'complete') {
    console.log('文件下载完成');
  }
});