import React, { useState, useCallback } from 'react';
import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface ExtractedImage {
  id: string;
  url: string;
  alt: string;
  src: string;
  dataSrc: string;
  dataLazySrc: string;
  dataOriginal: string;
  srcset: string;
  bgImage: string;
  source: string;
  width: number;
  height: number;
  size: string;
  type: string;
  selected: boolean;
}

interface ExtractionResult {
  url: string;
  html: string;
  images: ExtractedImage[];
  links: string[];
  buttons: string[];
}

type ExtractionMode = 'standard' | 'deep' | 'aggressive';

const App: React.FC = () => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<ExtractionResult | null>(null);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [previewImage, setPreviewImage] = useState<ExtractedImage | null>(null);
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('standard');
  const [history, setHistory] = useState<{url: string, timestamp: Date, count: number}[]>([]);
  const [activeTab, setActiveTab] = useState<'extractor' | 'history'>('extractor');

  const corsProxies = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
  ];

  const isValidUrl = (string: string): boolean => {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  };

  const getAbsoluteUrl = (base: string, relative: string): string => {
    if (!relative) return '';
    if (relative.startsWith('data:') || relative.startsWith('http://') || relative.startsWith('https://')) {
      return relative;
    }
    try {
      return new URL(relative, base).href;
    } catch {
      return relative;
    }
  };

  const extractImagesFromHtml = (html: string, baseUrl: string): ExtractedImage[] => {
    const $ = cheerio.load(html);
    const imageMap = new Map<string, ExtractedImage>();

    // Extract img tags
    $('img').each((index, element) => {
      const src = $(element).attr('src') || '';
      const dataSrc = $(element).attr('data-src') || '';
      const dataLazySrc = $(element).attr('data-lazy-src') || '';
      const dataOriginal = $(element).attr('data-original') || '';
      const srcset = $(element).attr('srcset') || '';
      const alt = $(element).attr('alt') || '';
      const width = parseInt($(element).attr('width') || '0', 10);
      const height = parseInt($(element).attr('height') || '0', 10);

      const allSources = [src, dataSrc, dataLazySrc, dataOriginal];
      
      // Extract from srcset
      if (srcset) {
        const srcsetUrls = srcset.split(',').map(s => {
          const parts = s.trim().split(/\s+/);
          return parts[0] || '';
        }).filter(Boolean);
        allSources.push(...srcsetUrls);
      }

      allSources.forEach((source, idx) => {
        if (source) {
          const absoluteUrl = getAbsoluteUrl(baseUrl, source);
          if (absoluteUrl && !imageMap.has(absoluteUrl) && !absoluteUrl.endsWith('.svg') && !absoluteUrl.includes('data:image/svg')) {
            const id = `img-${index}-${idx}-${Date.now()}`;
            const type = absoluteUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|ico)(\?.*)?$/i) 
              ? (absoluteUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|ico)(\?.*)?$/i)?.[1]?.toUpperCase() || 'UNKNOWN')
              : 'UNKNOWN';
            
            imageMap.set(absoluteUrl, {
              id,
              url: absoluteUrl,
              alt,
              src: getAbsoluteUrl(baseUrl, src),
              dataSrc: getAbsoluteUrl(baseUrl, dataSrc),
              dataLazySrc: getAbsoluteUrl(baseUrl, dataLazySrc),
              dataOriginal: getAbsoluteUrl(baseUrl, dataOriginal),
              srcset,
              bgImage: '',
              source: source === src ? '<img src>' : 
                      source === dataSrc ? '<img data-src>' : 
                      source === dataLazySrc ? '<img data-lazy-src>' : 
                      source === dataOriginal ? '<img data-original>' : '<img srcset>',
              width,
              height,
              size: width && height ? `${width}x${height}` : 'Unknown',
              type,
              selected: false
            });
          }
        }
      });
    });

    // Extract background images from inline styles
    $('*').each((index, element) => {
      const style = $(element).attr('style') || '';
      const bgImageMatches = style.match(/background(?:-image)?\s*:\s*url\(['"]?([^)'"]+)['"]?\)/gi);
      
      if (bgImageMatches) {
        bgImageMatches.forEach((match, idx) => {
          const urlMatch = match.match(/url\(['"]?([^)'"]+)['"]?\)/);
          if (urlMatch && urlMatch[1]) {
            const bgUrl = urlMatch[1];
            const absoluteUrl = getAbsoluteUrl(baseUrl, bgUrl);
            if (absoluteUrl && !imageMap.has(absoluteUrl) && !absoluteUrl.endsWith('.svg') && !absoluteUrl.includes('data:image/svg')) {
              const id = `bg-${index}-${idx}-${Date.now()}`;
              const type = absoluteUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|ico)(\?.*)?$/i) 
                ? (absoluteUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|ico)(\?.*)?$/i)?.[1]?.toUpperCase() || 'UNKNOWN')
                : 'UNKNOWN';
              
              imageMap.set(absoluteUrl, {
                id,
                url: absoluteUrl,
                alt: `Background image ${index}`,
                src: '',
                dataSrc: '',
                dataLazySrc: '',
                dataOriginal: '',
                srcset: '',
                bgImage: absoluteUrl,
                source: 'CSS background-image',
                width: 0,
                height: 0,
                size: 'Unknown',
                type,
                selected: false
              });
            }
          }
        });
      }
    });

    // Extract from meta tags (og:image, twitter:image)
    $('meta[property="og:image"], meta[name="og:image"], meta[property="twitter:image"], meta[name="twitter:image"]').each((index, element) => {
      const content = $(element).attr('content') || '';
      if (content) {
        const absoluteUrl = getAbsoluteUrl(baseUrl, content);
        if (absoluteUrl && !imageMap.has(absoluteUrl)) {
          const id = `meta-${index}-${Date.now()}`;
          const type = absoluteUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|ico)(\?.*)?$/i) 
            ? (absoluteUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|ico)(\?.*)?$/i)?.[1]?.toUpperCase() || 'UNKNOWN')
            : 'UNKNOWN';
          
          imageMap.set(absoluteUrl, {
            id,
            url: absoluteUrl,
            alt: $(element).attr('property') || $(element).attr('name') || 'Social share image',
            src: '',
            dataSrc: '',
            dataLazySrc: '',
            dataOriginal: '',
            srcset: '',
            bgImage: '',
            source: 'Meta tag',
            width: 0,
            height: 0,
            size: 'Unknown',
            type,
            selected: false
          });
        }
      }
    });

    // Deep extraction - look for image URLs in script tags and JSON data
    if (extractionMode === 'deep' || extractionMode === 'aggressive') {
      const scriptPatterns = [
        /["'](https?:\/\/[^"']*?\.(?:jpg|jpeg|png|gif|webp)(?:\?[^"']*)?)["']/gi,
        /["'](https?:\/\/[^"']*?\/images?\/[^"']*?)["']/gi,
        /["'](https?:\/\/[^"']*?\/photos?\/[^"']*?)["']/gi,
        /["'](https?:\/\/[^"']*?\/media?\/[^"']*?)["']/gi,
      ];

      scriptPatterns.forEach(pattern => {
        let match;
        const regex = new RegExp(pattern.source, 'gi');
        while ((match = regex.exec(html)) !== null) {
          const foundUrl = match[1];
          if (foundUrl && !imageMap.has(foundUrl) && !foundUrl.endsWith('.svg')) {
            const id = `script-${imageMap.size}-${Date.now()}`;
            const type = foundUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|ico)(\?.*)?$/i) 
              ? (foundUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|ico)(\?.*)?$/i)?.[1]?.toUpperCase() || 'UNKNOWN')
              : 'UNKNOWN';
            
            imageMap.set(foundUrl, {
              id,
              url: foundUrl,
              alt: `Script extracted image`,
              src: '',
              dataSrc: '',
              dataLazySrc: '',
              dataOriginal: '',
              srcset: '',
              bgImage: '',
              source: 'Script/JSON',
              width: 0,
              height: 0,
              size: 'Unknown',
              type,
              selected: false
            });
          }
        }
      });
    }

    return Array.from(imageMap.values());
  };

  const extractLinks = (html: string, baseUrl: string): string[] => {
    const $ = cheerio.load(html);
    const links: string[] = [];
    
    $('a').each((_index, element) => {
      const href = $(element).attr('href');
      if (href) {
        const absoluteUrl = getAbsoluteUrl(baseUrl, href);
        if (absoluteUrl.startsWith('http')) {
          links.push(absoluteUrl);
        }
      }
    });
    
    return [...new Set(links)].slice(0, 20);
  };

  const extractButtons = (html: string): string[] => {
    const $ = cheerio.load(html);
    const buttons: string[] = [];
    
    $('button, [role="button"], input[type="button"], input[type="submit"], .btn, .button').each((_index, element) => {
      const text = $(element).text().trim().replace(/\s+/g, ' ');
      
      if (text && text.length < 100) {
        buttons.push(text);
      }
    });
    
    return [...new Set(buttons)].slice(0, 15);
  };

  const fetchWithProxy = async (targetUrl: string): Promise<string> => {
    for (const proxy of corsProxies) {
      try {
        const response = await fetch(`${proxy}${encodeURIComponent(targetUrl)}`, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
        
        if (response.ok) {
          return await response.text();
        }
      } catch (e) {
        console.log(`Proxy ${proxy} failed:`, e);
        continue;
      }
    }
    
    // Final attempt: try without proxy (if target allows CORS)
    try {
      const response = await fetch(targetUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      
      if (response.ok) {
        return await response.text();
      }
    } catch (e) {
      console.log('Direct fetch failed:', e);
    }
    
    throw new Error('Failed to fetch the URL. The website may block CORS requests. Consider using a browser extension or server-side proxy.');
  };

  const handleExtract = useCallback(async () => {
    if (!isValidUrl(url)) {
      setError('Please enter a valid URL (including http:// or https://)');
      return;
    }

    setLoading(true);
    setError('');
    setResults(null);
    setSelectedImages(new Set());

    try {
      const html = await fetchWithProxy(url);
      const images = extractImagesFromHtml(html, url);
      const links = extractLinks(html, url);
      const buttons = extractButtons(html);

      const result: ExtractionResult = {
        url,
        html,
        images,
        links,
        buttons
      };

      setResults(result);
      setHistory(prev => [
        { url, timestamp: new Date(), count: images.length },
        ...prev.slice(0, 9)
      ]);

      if (images.length === 0) {
        setError('No images found on the page. Try using "Deep" or "Aggressive" extraction mode.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while extracting images');
    } finally {
      setLoading(false);
    }
  }, [url, extractionMode]);

  const toggleImageSelection = (imageId: string) => {
    setSelectedImages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(imageId)) {
        newSet.delete(imageId);
      } else {
        newSet.add(imageId);
      }
      return newSet;
    });

    if (results) {
      const updatedImages = results.images.map(img => ({
        ...img,
        selected: imageId === img.id ? !img.selected : img.selected
      }));
      setResults({ ...results, images: updatedImages });
    }
  };

  const toggleAllSelection = () => {
    if (!results) return;
    
    const allSelected = results.images.length === selectedImages.size;
    
    if (allSelected) {
      setSelectedImages(new Set());
      setResults({
        ...results,
        images: results.images.map(img => ({ ...img, selected: false }))
      });
    } else {
      const allIds = new Set(results.images.map(img => img.id));
      setSelectedImages(allIds);
      setResults({
        ...results,
        images: results.images.map(img => ({ ...img, selected: true }))
      });
    }
  };

  const downloadImage = async (imageUrl: string, filename: string) => {
    try {
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(imageUrl)}`;
      const response = await fetch(proxyUrl);
      const blob = await response.blob();
      saveAs(blob, filename);
    } catch (e) {
      // Fallback: open in new tab
      window.open(imageUrl, '_blank');
    }
  };

  const downloadSelected = async () => {
    if (!results || selectedImages.size === 0) return;

    const selectedImageList = results.images.filter(img => selectedImages.has(img.id));

    if (selectedImageList.length === 1) {
      const img = selectedImageList[0];
      const extension = img.type.toLowerCase() === 'unknown' ? 'jpg' : img.type.toLowerCase();
      downloadImage(img.url, `image-0.${extension}`);
      return;
    }

    // Multiple images - create zip
    const zip = new JSZip();
    
    for (let i = 0; i < selectedImageList.length; i++) {
      const img = selectedImageList[i];
      try {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(img.url)}`;
        const response = await fetch(proxyUrl);
        const blob = await response.blob();
        const extension = img.type.toLowerCase() === 'unknown' ? 'jpg' : img.type.toLowerCase();
        zip.file(`image-${i}.${extension}`, blob);
      } catch (e) {
        console.log(`Failed to fetch ${img.url}:`, e);
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'extracted-images.zip');
  };

  const getImageTypeColor = (type: string): string => {
    const colors: Record<string, string> = {
      'JPG': 'bg-blue-100 text-blue-700',
      'JPEG': 'bg-blue-100 text-blue-700',
      'PNG': 'bg-green-100 text-green-700',
      'GIF': 'bg-yellow-100 text-yellow-700',
      'WEBP': 'bg-teal-100 text-teal-700',
      'UNKNOWN': 'bg-gray-100 text-gray-600'
    };
    return colors[type] || 'bg-gray-100 text-gray-600';
  };

  const getSourceColor = (source: string): string => {
    if (source.includes('data-src') || source.includes('data-lazy')) return 'bg-orange-50 text-orange-600 border-orange-200';
    if (source.includes('CSS')) return 'bg-rose-50 text-rose-600 border-rose-200';
    if (source.includes('Script')) return 'bg-amber-50 text-amber-600 border-amber-200';
    if (source.includes('Meta')) return 'bg-cyan-50 text-cyan-600 border-cyan-200';
    return 'bg-emerald-50 text-emerald-600 border-emerald-200';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-800">Web Image Extractor</h1>
                <p className="text-sm text-slate-500">Extract images from any website including lazy-loaded and dynamic content</p>
              </div>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('extractor')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'extractor'
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                Extractor
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'history'
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                History ({history.length})
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'extractor' ? (
          <>
            {/* URL Input Section */}
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 mb-8">
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-700 mb-2">Website URL</label>
                <div className="flex gap-3">
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleExtract()}
                    placeholder="https://example.com"
                    className="flex-1 px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-slate-700 placeholder-slate-400"
                  />
                  <button
                    onClick={handleExtract}
                    disabled={loading || !url}
                    className="px-8 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl flex items-center gap-2"
                  >
                    {loading ? (
                      <>
                        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Extracting...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        Extract
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Extraction Mode */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Extraction Mode</label>
                <div className="flex gap-3">
                  {[
                    { mode: 'standard' as ExtractionMode, label: 'Standard', desc: 'Extract <img> tags', icon: '📷' },
                    { mode: 'deep' as ExtractionMode, label: 'Deep', desc: 'Include script data', icon: '🔍' },
                    { mode: 'aggressive' as ExtractionMode, label: 'Aggressive', desc: 'Extract all URLs', icon: '🔥' }
                  ].map(({ mode, label, desc, icon }) => (
                    <button
                      key={mode}
                      onClick={() => setExtractionMode(mode)}
                      className={`flex-1 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                        extractionMode === mode
                          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{icon}</span>
                        <div>
                          <div className={`font-semibold text-sm ${extractionMode === mode ? 'text-blue-700' : 'text-slate-700'}`}>
                            {label}
                          </div>
                          <div className="text-xs text-slate-500">{desc}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-8">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h4 className="font-semibold text-red-700">Extraction Failed</h4>
                    <p className="text-sm text-red-600 mt-1">{error}</p>
                    <p className="text-xs text-red-500 mt-2">
                      💡 Tip: Some websites block CORS requests. Try using a browser extension like "Allow CORS" or use the browser's DevTools (F12) to inspect network traffic.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Buttons found on page */}
            {results && results.buttons.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                  </svg>
                  <div className="flex-1">
                    <h4 className="font-semibold text-amber-700">Interactive Buttons Found on Page</h4>
                    <p className="text-xs text-amber-600 mt-1 mb-3">
                      Some images may be loaded dynamically when you click buttons. This tool extracts static HTML content.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {results.buttons.map((btn, idx) => (
                        <span key={idx} className="px-3 py-1 bg-white border border-amber-200 rounded-full text-xs text-amber-700">
                          {btn}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Results */}
            {results && (
              <div className="space-y-6">
                {/* Results Header */}
                <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">
                        Extraction Complete
                      </h2>
                      <p className="text-slate-500 mt-1">
                        Found <span className="font-semibold text-blue-600">{results.images.length}</span> images from{" "}
                        <span className="text-slate-600 font-mono text-sm bg-slate-100 px-2 py-1 rounded">{url}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-slate-500">
                        {selectedImages.size} selected
                      </span>
                      <button
                        onClick={toggleAllSelection}
                        className="px-4 py-2 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-all text-sm"
                      >
                        {selectedImages.size === results.images.length ? 'Deselect All' : 'Select All'}
                      </button>
                      <button
                        onClick={downloadSelected}
                        disabled={selectedImages.size === 0}
                        className="px-4 py-2 bg-emerald-500 text-white font-medium rounded-lg hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download {selectedImages.size > 0 && `(${selectedImages.size})`}
                      </button>
                    </div>
                  </div>

                  {/* Source Stats */}
                  <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-slate-100">
                    {[
                      { label: 'From <img>', filter: (s: string) => s.includes('<img'), color: 'text-emerald-600 bg-emerald-50' },
                      { label: 'Lazy Loaded', filter: (s: string) => s.includes('data-'), color: 'text-orange-600 bg-orange-50' },
                      { label: 'CSS Backgrounds', filter: (s: string) => s.includes('CSS'), color: 'text-rose-600 bg-rose-50' },
                      { label: 'Scripts/JSON', filter: (s: string) => s.includes('Script'), color: 'text-amber-600 bg-amber-50' },
                      { label: 'Meta Tags', filter: (s: string) => s.includes('Meta'), color: 'text-cyan-600 bg-cyan-50' },
                    ].map(({ label, filter, color }) => {
                      const count = results.images.filter(i => filter(i.source)).length;
                      if (count === 0) return null;
                      return (
                        <span key={label} className={`px-3 py-1 rounded-full text-xs font-medium ${color}`}>
                          {label}: {count}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Image Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {results.images.map((image) => (
                    <div
                      key={image.id}
                      onClick={() => toggleImageSelection(image.id)}
                      className={`group bg-white rounded-xl border-2 shadow-sm overflow-hidden cursor-pointer transition-all hover:shadow-lg ${
                        image.selected
                          ? 'border-blue-500 ring-4 ring-blue-100'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {/* Image Container */}
                      <div className="relative aspect-square bg-slate-100 overflow-hidden">
                        <img
                          src={image.url}
                          alt={image.alt}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                          onError={(e) => {
                            // Show placeholder on error
                            (e.target as HTMLImageElement).style.display = 'none';
                            (e.target as HTMLImageElement).parentElement!.innerHTML = `
                              <div class="w-full h-full flex flex-col items-center justify-center bg-slate-100">
                                <svg class="w-12 h-12 text-slate-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span class="text-xs text-slate-500">Failed to load</span>
                              </div>
                            `;
                          }}
                        />
                        
                        {/* Selection Indicator */}
                        <div className={`absolute top-3 left-3 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          image.selected 
                            ? 'bg-blue-500 border-blue-500' 
                            : 'bg-white border-slate-300 opacity-0 group-hover:opacity-100'
                        }`}>
                          {image.selected && (
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>

                        {/* Preview Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewImage(image);
                          }}
                          className="absolute top-3 right-3 w-8 h-8 bg-white/90 backdrop-blur-sm rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-md hover:bg-white"
                        >
                          <svg className="w-4 h-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>

                        {/* Type Badge */}
                        <div className="absolute bottom-3 right-3">
                          <span className={`px-2 py-1 rounded-md text-xs font-bold shadow ${getImageTypeColor(image.type)}`}>
                            {image.type}
                          </span>
                        </div>
                      </div>

                      {/* Info */}
                      <div className="p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`px-2 py-0.5 rounded-md text-xs border ${getSourceColor(image.source)}`}>
                            {image.source}
                          </span>
                        </div>
                        {image.alt && (
                          <p className="text-xs text-slate-500 truncate" title={image.alt}>
                            {image.alt}
                          </p>
                        )}
                        <p className="text-xs text-slate-400 truncate mt-1 font-mono" title={image.url}>
                          {image.url.length > 40 ? image.url.substring(0, 40) + '...' : image.url}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {!results && !loading && !error && (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-16 text-center">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-cyan-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Extract Images from Any Website</h3>
                <p className="text-slate-500 mb-8 max-w-md mx-auto">
                  Enter a URL above to extract all images from a webpage, including lazy-loaded images,
                  CSS backgrounds, and dynamically loaded content.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
                  {[
                    { icon: '🖼️', title: 'HTML Images', desc: 'Extract all <img> tags with src, data-src, and srcset attributes' },
                    { icon: '🎨', title: 'CSS Backgrounds', desc: 'Find background images in inline styles and stylesheets' },
                    { icon: '📜', title: 'Dynamic Content', desc: 'Scan script tags and JSON data for hidden image URLs' }
                  ].map(({ icon, title, desc }) => (
                    <div key={title} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                      <div className="text-2xl mb-2">{icon}</div>
                      <h4 className="font-semibold text-slate-700 text-sm">{title}</h4>
                      <p className="text-xs text-slate-500 mt-1">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* History Tab */
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200">
            {history.length > 0 ? (
              <div className="divide-y divide-slate-100">
                <div className="p-6">
                  <h2 className="text-xl font-bold text-slate-800">Extraction History</h2>
                  <p className="text-slate-500 text-sm mt-1">Your recent extraction sessions</p>
                </div>
                {history.map((item, idx) => (
                  <div key={idx} className="p-6 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-800 truncate">{item.url}</p>
                        <p className="text-sm text-slate-500 mt-1">
                          {item.timestamp.toLocaleString()} • {item.count} images found
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setUrl(item.url);
                          setActiveTab('extractor');
                        }}
                        className="ml-4 px-4 py-2 bg-blue-50 text-blue-600 font-medium rounded-lg hover:bg-blue-100 transition-all text-sm"
                      >
                        Re-Extract
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-16 text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-slate-700 mb-1">No History Yet</h3>
                <p className="text-slate-500 text-sm">Your extraction history will appear here</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Preview Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div 
            className="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-slate-800 truncate">{previewImage.alt || 'Image Preview'}</h3>
                <p className="text-xs text-slate-500 truncate">{previewImage.url}</p>
              </div>
              <button
                onClick={() => setPreviewImage(null)}
                className="ml-4 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
              >
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 bg-slate-50 flex items-center justify-center overflow-auto" style={{ maxHeight: '60vh' }}>
              <img
                src={previewImage.url}
                alt={previewImage.alt}
                className="max-w-full h-auto rounded-lg shadow-lg"
              />
            </div>
            <div className="p-4 border-t border-slate-200 bg-slate-50">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-slate-500 block">Source</label>
                  <span className={`px-2 py-1 rounded-md text-xs border mt-1 inline-block ${getSourceColor(previewImage.source)}`}>
                    {previewImage.source}
                  </span>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block">Type</label>
                  <span className={`px-2 py-1 rounded-md text-xs font-bold mt-1 inline-block ${getImageTypeColor(previewImage.type)}`}>
                    {previewImage.type}
                  </span>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block">Dimensions</label>
                  <p className="font-medium text-slate-700 mt-1">{previewImage.size}</p>
                </div>
                <div className="text-right">
                  <button
                    onClick={() => {
                      const extension = previewImage.type.toLowerCase() === 'unknown' ? 'jpg' : previewImage.type.toLowerCase();
                      downloadImage(previewImage.url, `image.${extension}`);
                    }}
                    className="px-4 py-2 bg-emerald-500 text-white font-medium rounded-lg hover:bg-emerald-600 transition-all text-sm flex items-center gap-2 ml-auto"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </button>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-200">
                <label className="text-xs text-slate-500 block mb-1">Full URL</label>
                <div className="flex gap-2">
                  <code className="flex-1 text-xs text-slate-600 bg-white px-3 py-2 rounded-lg border border-slate-200 overflow-auto">
                    {previewImage.url}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(previewImage.url)}
                    className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all text-sm"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;