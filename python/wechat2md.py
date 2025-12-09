#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信公众号文章转Markdown工具
使用方法：python wechat2md.py <文章URL>
批量处理：python wechat2md.py urls.txt
"""

import requests
from bs4 import BeautifulSoup
import html2text
import os
import re
import sys
from urllib.parse import urlparse
import time

class WechatToMarkdown:
    def __init__(self, output_dir='output'):
        self.output_dir = output_dir
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://mp.weixin.qq.com/'
        }
        self.session = requests.Session()
        
        # 配置html2text
        self.h = html2text.HTML2Text()
        self.h.ignore_links = False
        self.h.ignore_images = False
        self.h.ignore_emphasis = False
        self.h.body_width = 0  # 不自动换行
        self.h.unicode_snob = True
        self.h.skip_internal_links = False
        
        # 创建输出目录
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
            print(f"✅ 创建输出目录: {output_dir}")

    def get_article_content(self, url):
        """获取文章内容"""
        try:
            print(f"📡 正在获取文章: {url}")
            response = self.session.get(url, headers=self.headers, timeout=30)
            response.encoding = 'utf-8'
            
            if response.status_code != 200:
                raise Exception(f"HTTP {response.status_code}")
            
            return response.text
        except Exception as e:
            raise Exception(f"获取文章失败: {str(e)}")

    def extract_article_info(self, html):
        """提取文章信息"""
        soup = BeautifulSoup(html, 'html.parser')
        
        # 提取标题
        title = None
        title_tag = soup.find('h1', class_='rich_media_title')
        if title_tag:
            title = title_tag.get_text().strip()
        
        if not title:
            title_tag = soup.find('title')
            if title_tag:
                title = title_tag.get_text().strip()
        
        if not title:
            title = "未命名文章"
        
        # 提取作者
        author = None
        author_tag = soup.find('a', class_='rich_media_meta_link')
        if author_tag:
            author = author_tag.get_text().strip()
        
        # 提取发布时间
        publish_time = None
        time_tag = soup.find('em', id='publish_time')
        if time_tag:
            publish_time = time_tag.get_text().strip()
        
        # 提取正文内容
        content = None
        content_tag = soup.find('div', class_='rich_media_content')
        if content_tag:
            content = str(content_tag)
        
        if not content:
            raise Exception("未找到文章正文内容")
        
        return {
            'title': title,
            'author': author,
            'publish_time': publish_time,
            'content': content
        }

    def clean_filename(self, filename):
        """清理文件名，移除非法字符"""
        # 移除或替换非法字符
        filename = re.sub(r'[\\/*?:"<>|]', '', filename)
        # 限制长度
        if len(filename) > 100:
            filename = filename[:100]
        return filename

    def download_images(self, content, article_dir):
        """下载文章中的图片（可选功能）"""
        soup = BeautifulSoup(content, 'html.parser')
        images = soup.find_all('img')
        
        img_dir = os.path.join(article_dir, 'images')
        if images and not os.path.exists(img_dir):
            os.makedirs(img_dir)
        
        for idx, img in enumerate(images):
            data_src = img.get('data-src')
            src = img.get('src')
            img_url = data_src or src
            
            if img_url:
                try:
                    print(f"  📥 下载图片 {idx + 1}/{len(images)}")
                    img_response = self.session.get(img_url, headers=self.headers, timeout=15)
                    if img_response.status_code == 200:
                        # 生成图片文件名
                        ext = os.path.splitext(urlparse(img_url).path)[1] or '.jpg'
                        img_filename = f"image_{idx + 1}{ext}"
                        img_path = os.path.join(img_dir, img_filename)
                        
                        with open(img_path, 'wb') as f:
                            f.write(img_response.content)
                        
                        # 替换HTML中的图片链接为本地路径
                        img['src'] = f"images/{img_filename}"
                        if data_src:
                            del img['data-src']
                    time.sleep(0.5)  # 避免请求过快
                except Exception as e:
                    print(f"  ⚠️  图片下载失败: {str(e)}")
        
        return str(soup)

    def convert_to_markdown(self, article_info, download_imgs=False):
        """转换为Markdown格式"""
        content = article_info['content']
        
        # 创建文章专属目录（如果需要下载图片）
        if download_imgs:
            article_dir = os.path.join(self.output_dir, self.clean_filename(article_info['title']))
            if not os.path.exists(article_dir):
                os.makedirs(article_dir)
            content = self.download_images(content, article_dir)
        else:
            article_dir = self.output_dir
        
        # 转换为Markdown
        markdown_content = self.h.handle(content)
        
        # 构建完整的Markdown文档
        markdown = f"# {article_info['title']}\n\n"
        
        if article_info['author']:
            markdown += f"**作者**: {article_info['author']}\n\n"
        
        if article_info['publish_time']:
            markdown += f"**发布时间**: {article_info['publish_time']}\n\n"
        
        markdown += "---\n\n"
        markdown += markdown_content
        
        return markdown, article_dir

    def save_markdown(self, markdown, filename, article_dir):
        """保存Markdown文件"""
        filepath = os.path.join(article_dir, f"{filename}.md")
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(markdown)
        
        print(f"✅ 保存成功: {filepath}")
        return filepath

    def process_url(self, url, download_imgs=False):
        """处理单个URL"""
        try:
            # 获取文章内容
            html = self.get_article_content(url)
            
            # 提取文章信息
            article_info = self.extract_article_info(html)
            print(f"📄 文章标题: {article_info['title']}")
            
            # 转换为Markdown
            markdown, article_dir = self.convert_to_markdown(article_info, download_imgs)
            
            # 保存文件
            filename = self.clean_filename(article_info['title'])
            self.save_markdown(markdown, filename, article_dir)
            
            return True, article_info['title']
        except Exception as e:
            print(f"❌ 处理失败: {str(e)}")
            return False, str(e)

    def process_file(self, filepath, download_imgs=False):
        """批量处理文件中的URL列表"""
        with open(filepath, 'r', encoding='utf-8') as f:
            urls = [line.strip() for line in f if line.strip()]
        
        print(f"📋 共找到 {len(urls)} 个链接\n")
        
        success_count = 0
        fail_count = 0
        
        for idx, url in enumerate(urls, 1):
            print(f"\n[{idx}/{len(urls)}] 处理中...")
            success, result = self.process_url(url, download_imgs)
            
            if success:
                success_count += 1
            else:
                fail_count += 1
            
            # 延迟避免请求过快
            if idx < len(urls):
                time.sleep(2)
        
        print(f"\n{'='*50}")
        print(f"✅ 成功: {success_count} 篇")
        print(f"❌ 失败: {fail_count} 篇")
        print(f"{'='*50}")


def main():
    print("="*50)
    print("微信公众号文章转Markdown工具")
    print("="*50 + "\n")
    
    if len(sys.argv) < 2:
        print("使用方法:")
        print("  单个链接: python wechat2md.py <URL>")
        print("  批量处理: python wechat2md.py <文件路径>")
        print("\n选项:")
        print("  --download-images  下载图片到本地")
        print("\n示例:")
        print("  python wechat2md.py https://mp.weixin.qq.com/s/xxxxx")
        print("  python wechat2md.py urls.txt")
        print("  python wechat2md.py urls.txt --download-images")
        sys.exit(1)
    
    input_arg = sys.argv[1]
    download_imgs = '--download-images' in sys.argv
    
    converter = WechatToMarkdown()
    
    # 判断是URL还是文件
    if input_arg.startswith('http'):
        # 单个URL
        converter.process_url(input_arg, download_imgs)
    elif os.path.isfile(input_arg):
        # 批量处理文件
        converter.process_file(input_arg, download_imgs)
    else:
        print(f"❌ 错误: 找不到文件或无效的URL: {input_arg}")
        sys.exit(1)


if __name__ == '__main__':
    main()