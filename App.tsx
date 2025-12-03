/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useState, useRef, useEffect } from 'react';
import { generateImage, generateVoxelScene, IMAGE_SYSTEM_PROMPT, VOXEL_PROMPT } from './services/gemini';
import { extractHtmlFromText, hideBodyText, exposeThreeJSObjects, injectGameControls, updateCameraSettings } from './utils/html';
import { languages, defaultLanguage, LanguageCode } from './languages';

type AppStatus = 'idle' | 'generating_image' | 'generating_voxels' | 'error';

const APP_VERSION = "v1.2.0";

// Available aspect ratios
const ASPECT_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16"];

// Allowed file types
const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif'
];

const SAMPLE_PROMPTS = [
    "A tree house under the sea",
    "A cyberpunk street food stall", 
    "An ancient temple floating in the sky",
    "A cozy winter cabin with smoke",
    "A futuristic mars rover",
    "A dragon guarding gold"
];

interface Example {
  img: string;
  html: string;
}

const EXAMPLES: Example[] = [
  { img: 'https://www.gstatic.com/aistudio/starter-apps/image_to_voxel/example1.png', html: '/examples/example1.html' },
  { img: 'https://www.gstatic.com/aistudio/starter-apps/image_to_voxel/example2.png', html: '/examples/example2.html' },
  { img: 'https://www.gstatic.com/aistudio/starter-apps/image_to_voxel/example3.png', html: '/examples/example3.html' },
];

const App: React.FC = () => {
  const [currentLang, setCurrentLang] = useState<LanguageCode>(defaultLanguage);
  const t = languages[currentLang].data;

  // New Input States
  const [descPrompt, setDescPrompt] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [animPrompt, setAnimPrompt] = useState('');

  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  
  // Main View State
  // Changed: imageData is now used for the *displayed* image in the view mode, 
  // but we store all uploaded images in inputImages
  const [inputImages, setInputImages] = useState<string[]>([]);
  const [displayedImageIndex, setDisplayedImageIndex] = useState<number>(0);

  const [voxelCode, setVoxelCode] = useState<string | null>(null);
  
  // User Content Persistence (Stores the user's work separately from examples)
  const [userContent, setUserContent] = useState<{
      images: string[];
      voxel: string | null;
      // We store the full prompts here for restoration
      prompts: { desc: string; style: string; anim: string };
  } | null>(null);

  // Navigation State
  const [selectedTile, setSelectedTile] = useState<number | 'user' | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);

  const [status, setStatus] = useState<AppStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [useOptimization, setUseOptimization] = useState(true);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [viewMode, setViewMode] = useState<'image' | 'voxel'>('image');
  
  // Streaming Thoughts State
  const [thinkingText, setThinkingText] = useState<string | null>(null);
  
  const [loadedThumbnails, setLoadedThumbnails] = useState<Record<string, string>>({});

  // New UI States
  const [isDragging, setIsDragging] = useState(false);
  const [isViewerVisible, setIsViewerVisible] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Rotate placeholders
  useEffect(() => {
    const interval = setInterval(() => {
        setPlaceholderIndex((prev) => (prev + 1) % SAMPLE_PROMPTS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Global Paste Listener
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData) {
        // Prioritize items (handles 'Copy Image' from browser context menu)
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (blob) {
                    processFile(blob);
                    e.preventDefault();
                    return; // Only paste one at a time via global paste to avoid spam
                }
            }
        }
        
        // Fallback to files (handles file system copy/paste)
        if (e.clipboardData.files.length > 0) {
          const file = e.clipboardData.files[0];
          processFile(file);
          e.preventDefault();
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  // Load thumbnails
  useEffect(() => {
    const createdUrls: string[] = [];
    const loadThumbnails = async () => {
      const loaded: Record<string, string> = {};
      await Promise.all(EXAMPLES.map(async (ex) => {
        try {
          const response = await fetch(ex.img);
          if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            loaded[ex.img] = url;
          }
        } catch (e) {
          console.error("Failed to load thumbnail:", ex.img, e);
        }
      }));
      setLoadedThumbnails(loaded);
    };
    loadThumbnails();

    return () => {
        createdUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  const handleError = (err: any) => {
    setStatus('error');
    setErrorMsg(err.message || 'An unexpected error occurred.');
    console.error(err);
  };

  const handleImageGenerate = async () => {
    const hasDesc = descPrompt.trim().length > 0;
    if (!hasDesc) return;
    
    const combinedPrompt = `${descPrompt}. Style: ${stylePrompt}`;

    setStatus('generating_image');
    setErrorMsg('');
    // For fresh generation, clear old images and voxel code
    setInputImages([]);
    setVoxelCode(null);
    setThinkingText(null);
    setViewMode('image');
    
    setIsViewerVisible(true);

    try {
      const imageUrl = await generateImage(combinedPrompt, aspectRatio, useOptimization);
      
      const newImages = [imageUrl];
      
      // Update User Content
      const newUserContent = {
          images: newImages,
          voxel: null,
          prompts: { desc: descPrompt, style: stylePrompt, anim: animPrompt }
      };
      setUserContent(newUserContent);
      
      // Update View
      setInputImages(newImages);
      setDisplayedImageIndex(0);
      setVoxelCode(null);
      setSelectedTile('user');
      
      setStatus('idle');
      setShowGenerator(false); 
    } catch (err) {
      handleError(err);
    }
  };

  const processFile = (file: File) => {
    if (!ALLOWED_MIME_TYPES.includes(file.type) && !file.type.startsWith('image/')) {
      handleError(new Error("Invalid file type. Please upload PNG, JPEG, WEBP, HEIC, or HEIF."));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      
      // Append to existing images
      setInputImages(prev => {
          const updated = [...prev, result];
          
          // Update persisted state
          setUserContent({
            images: updated,
            voxel: voxelCode, // Keep existing voxel code if adding ref images to refine
            prompts: { desc: descPrompt, style: stylePrompt, anim: animPrompt }
          });
          
          // Switch view to the new image
          setDisplayedImageIndex(updated.length - 1);
          return updated;
      });

      setViewMode('image');
      setStatus('idle');
      setErrorMsg('');
      setSelectedTile('user');
      
      // KEEP GENERATOR OPEN
      setShowGenerator(true); 
      setIsViewerVisible(true);
    };
    reader.onerror = () => handleError(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
        Array.from(event.target.files).forEach(file => processFile(file as File));
    }
  };
  
  const handlePasteClick = async () => {
      try {
          if (!navigator.clipboard || !navigator.clipboard.read) {
               throw new Error("Clipboard API not available in this context");
          }

          const clipboardItems = await navigator.clipboard.read();
          let found = false;
          for (const item of clipboardItems) {
              const imageTypes = item.types.filter(type => type.startsWith('image/'));
              if (imageTypes.length > 0) {
                  const blob = await item.getType(imageTypes[0]);
                  processFile(new File([blob], "pasted-image", { type: imageTypes[0] }));
                  found = true;
              }
          }
          if (!found) {
              alert("No image found in clipboard.");
          }
      } catch (err: any) {
          console.warn("Clipboard read error:", err.message);
          alert("Could not access clipboard directly (check browser permissions). Please click on the page and press Ctrl+V to paste.");
      }
  };

  const clearImages = () => {
      setInputImages([]);
      setDisplayedImageIndex(0);
      setUserContent(prev => prev ? ({...prev, images: []}) : null);
  };

  const removeImage = (index: number) => {
      const newImages = inputImages.filter((_, i) => i !== index);
      setInputImages(newImages);
      if (displayedImageIndex >= newImages.length) {
          setDisplayedImageIndex(Math.max(0, newImages.length - 1));
      }
      setUserContent(prev => prev ? ({...prev, images: newImages}) : null);
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
        Array.from(e.dataTransfer.files).forEach(file => processFile(file as File));
    }
  };

  const handleExampleClick = async (example: Example, index: number) => {
    if (status !== 'idle' && status !== 'error') return;
    
    setSelectedTile(index);
    setShowGenerator(false);
    setErrorMsg('');
    setThinkingText(null);
    setIsViewerVisible(true);
    
    try {
      // 1. Fetch Image
      const imgResponse = await fetch(example.img);
      if (!imgResponse.ok) throw new Error(`Failed to load example image: ${imgResponse.statusText}`);
      const imgBlob = await imgResponse.blob();
      
      const base64Img = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(imgBlob);
      });

      // 2. Fetch HTML
      let htmlText = '';
      try {
        const htmlResponse = await fetch(example.html);
        if (htmlResponse.ok) {
            const rawText = await htmlResponse.text();
            htmlText = injectGameControls(
                exposeThreeJSObjects(
                    hideBodyText(extractHtmlFromText(rawText))
                ), t
            );
        } else {
            console.warn("HTML file not found, using placeholder");
            htmlText = `<html><body><p>${example.html} not found.</p></body></html>`;
        }
      } catch (e) {
          console.warn("Failed to fetch HTML", e);
          htmlText = "<html><body>Error loading example scene.</body></html>";
      }

      setInputImages([base64Img]);
      setDisplayedImageIndex(0);
      setVoxelCode(htmlText);
      setViewMode('voxel');
      setStatus('idle');

    } catch (err) {
      handleError(err);
    }
  };

  const handleUserTileClick = () => {
      if (status !== 'idle' && status !== 'error') return;

      if (selectedTile === 'user') {
          const willShow = !showGenerator;
          setShowGenerator(willShow);
          if (willShow) setIsViewerVisible(false);
          else {
            setIsViewerVisible(true);
            if (!userContent) setSelectedTile(null);
          }
      } else {
          setSelectedTile('user');
          setShowGenerator(true); 
          setIsViewerVisible(false);

          if (userContent) {
              setInputImages(userContent.images);
              setDisplayedImageIndex(0);
              setVoxelCode(userContent.voxel);
              setDescPrompt(userContent.prompts.desc);
              setStylePrompt(userContent.prompts.style);
              setAnimPrompt(userContent.prompts.anim);
              
              setViewMode(userContent.voxel ? 'voxel' : 'image');
          } else {
              setInputImages([]);
              setVoxelCode(null);
              setDescPrompt('');
              setStylePrompt('');
              setAnimPrompt('');
              setViewMode('image');
          }
      }
  };

  const handleVoxelize = async () => {
    if (inputImages.length === 0 && !voxelCode) {
        // If we have code but no images, we can technically refine, 
        // but usually we want at least one image or code.
        if (!voxelCode) return;
    }

    setStatus('generating_voxels');
    setErrorMsg('');
    setThinkingText(null);
    setIsViewerVisible(true);
    
    let thoughtBuffer = "";
    
    const voxelContext = `
        ${descPrompt ? `Scene Description: ${descPrompt}` : ''}
        ${stylePrompt ? `Style: ${stylePrompt}` : ''}
        ${animPrompt ? `Animations & Interactivity: ${animPrompt}` : ''}
    `.trim();

    try {
      // Pass all images and any existing code for refinement
      const codeRaw = await generateVoxelScene(
          inputImages, 
          voxelContext, 
          voxelCode, // Pass previous code to enable editing
          (thoughtFragment) => {
          thoughtBuffer += thoughtFragment;
          const matches = thoughtBuffer.match(/\*\*([^*]+)\*\*/g);
          if (matches && matches.length > 0) {
              const lastMatch = matches[matches.length - 1];
              const header = lastMatch.replace(/\*\*/g, '').trim();
              setThinkingText(prev => prev === header ? prev : header);
          }
      });
      
      const code = injectGameControls(
          exposeThreeJSObjects(
              hideBodyText(codeRaw)
          ), t
      );
      setVoxelCode(code);
      
      if (selectedTile === 'user') {
          setUserContent(prev => prev ? ({...prev, voxel: code, prompts: { desc: descPrompt, style: stylePrompt, anim: animPrompt } }) : null);
      }
      
      setViewMode('voxel');
      setStatus('idle');
      setThinkingText(null);
    } catch (err) {
      handleError(err);
    }
  };

  const getExportCode = () => {
    let codeToExport = voxelCode || "";
    if (viewMode === 'voxel' && iframeRef.current && iframeRef.current.contentWindow) {
        try {
            const win = iframeRef.current.contentWindow as any;
            if (typeof win.getSceneState === 'function') {
                const state = win.getSceneState();
                if (state) {
                    if (window.confirm("Do you want to use the current camera view as the default start position?")) {
                        codeToExport = updateCameraSettings(codeToExport, state.position, state.target);
                    }
                }
            }
        } catch (e) {
            console.warn("Could not access iframe state for camera sync", e);
        }
    }
    return codeToExport;
  }

  const handleDownload = () => {
    if (viewMode === 'image' && inputImages[displayedImageIndex]) {
      const a = document.createElement('a');
      a.href = inputImages[displayedImageIndex];
      const ext = inputImages[displayedImageIndex].includes('image/jpeg') ? 'jpg' : 'png';
      a.download = `voxelize-image-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else if (viewMode === 'voxel' && voxelCode) {
      const finalCode = getExportCode();
      const a = document.createElement('a');
      a.href = `data:text/html;charset=utf-8,${encodeURIComponent(finalCode)}`;
      a.download = `voxel-scene-${Date.now()}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleGLBDownload = () => {
    if (viewMode === 'voxel' && iframeRef.current && iframeRef.current.contentWindow) {
        try {
            const win = iframeRef.current.contentWindow as any;
            if (typeof win.exportGLB === 'function') {
                win.exportGLB();
            } else {
                alert("GLTF Exporter not ready yet. Please wait a moment or regenerate the scene.");
            }
        } catch (e) {
            console.error(e);
            alert("Could not access scene for export.");
        }
    }
  };

  const handleCopyEmbed = () => {
    if (!voxelCode) return;
    const finalCode = getExportCode();
    navigator.clipboard.writeText(finalCode).then(() => {
      alert("Full HTML code copied to clipboard!");
    }, (err) => {
      console.error('Could not copy text: ', err);
    });
  };

  const isLoading = status !== 'idle' && status !== 'error';
  const currentImageData = inputImages[displayedImageIndex] || null;

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 font-sans bg-white relative">
      <style>
        {`
          .loading-dots::after {
            content: '';
            animation: dots 2s steps(4, end) infinite;
          }
          @keyframes dots {
            0%, 20% { content: ''; }
            40% { content: '.'; }
            60% { content: '..'; }
            80% { content: '...'; }
          }
        `}
      </style>

      {/* Language Selector */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        <span className="text-xs font-mono text-gray-400">{APP_VERSION}</span>
        <select
          value={currentLang}
          onChange={(e) => setCurrentLang(e.target.value as LanguageCode)}
          className="border-2 border-black bg-white px-2 py-1 font-bold text-sm uppercase focus:outline-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
        >
           {Object.entries(languages).map(([code, lang]) => (
             <option key={code} value={code}>{lang.name}</option>
           ))}
        </select>
      </div>

      <div className="w-full max-w-2xl space-y-8">
        
        {/* Header */}
        <div className="text-center border-b-2 border-black pb-6">
          <h1 className="text-4xl sm:text-5xl font-black leading-[0.9] tracking-tight uppercase">{t.title}</h1>
          <p className="mt-2 text-lg text-gray-600 font-semibold">{t.subtitle}</p>
        </div>

        {/* Tiles */}
        <div className="grid grid-cols-4 gap-4 w-full">
            {EXAMPLES.map((ex, idx) => (
                <button
                    key={idx}
                    type="button"
                    onClick={() => handleExampleClick(ex, idx)}
                    disabled={isLoading}
                    className={`aspect-square relative overflow-hidden group focus:outline-none disabled:opacity-50 cursor-pointer bg-gray-100 transition-all duration-200
                        border-2 border-black
                        active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:scale-100
                        ${selectedTile === idx 
                            ? 'scale-[1.02] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] -translate-y-1' 
                            : 'hover:border-gray-600 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]'}
                    `}
                >
                     {loadedThumbnails[ex.img] && (
                        <img src={loadedThumbnails[ex.img]} alt={`Ex ${idx}`} className="w-full h-full object-cover" />
                     )}
                </button>
            ))}
            
             {/* User Tile */}
             <button
                type="button"
                onClick={handleUserTileClick}
                disabled={isLoading}
                className={`aspect-square flex flex-col items-center justify-center transition-all duration-200 focus:outline-none disabled:opacity-50 group overflow-hidden relative border-2 border-black
                    active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:scale-100
                    ${selectedTile === 'user' ? 'scale-[1.02] -translate-y-1' : 'hover:border-gray-600 hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]'}
                    ${!userContent && !showGenerator ? 'bg-white text-black hover:bg-gray-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' : 'bg-white'}
                    ${showGenerator && selectedTile === 'user' 
                        ? 'bg-black text-white shadow-[4px_4px_0px_0px_#888]' 
                        : (selectedTile === 'user' ? 'shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]' : 'shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]')}
                `}
             >
                 {userContent && userContent.images.length > 0 ? (
                     <>
                        <img src={userContent.images[0]} alt="My Gen" className="w-full h-full object-cover" />
                        {selectedTile === 'user' && showGenerator && (
                            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                                <span className="text-white font-bold uppercase text-sm">{t.buttons.editing}</span>
                            </div>
                        )}
                     </>
                 ) : (
                    <>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-10 h-10 transition-transform duration-300 ${showGenerator ? 'rotate-45' : 'group-hover:scale-110'}`}>
                            <path strokeLinecap="square" strokeLinejoin="miter" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        <span className="text-xs font-bold uppercase mt-2">{showGenerator ? t.buttons.close : t.buttons.generate}</span>
                    </>
                 )}
             </button>
        </div>

        {/* Generator Input Section */}
        {showGenerator && (
            <div className="space-y-6 animate-in slide-in-from-top-4 fade-in duration-300 border-2 border-black p-6 bg-gray-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] relative z-10">
            
            {/* Upload Section */}
            <div className="w-full relative">
                <label className="block text-sm font-bold mb-2 uppercase">
                    {t.inputs.upload_text}
                </label>
                <div 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`
                        w-full h-24 border-2 border-dashed border-black flex flex-col items-center justify-center cursor-pointer transition-colors
                        ${isDragging ? 'bg-gray-200' : 'bg-white hover:bg-gray-50'}
                    `}
                >
                    <input
                        type="file"
                        multiple
                        accept={ALLOWED_MIME_TYPES.join(',')}
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                    />
                    <p className="font-bold uppercase text-xs text-gray-600 text-center px-4">{t.inputs.drag_drop}</p>
                    <button 
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handlePasteClick(); }}
                        className="mt-2 px-3 py-1 bg-gray-200 hover:bg-gray-300 text-xs font-bold uppercase border border-black"
                    >
                        {t.buttons.paste_image}
                    </button>
                </div>
            </div>

            {/* Image List */}
            {inputImages.length > 0 && (
                <div className="flex gap-2 overflow-x-auto py-2">
                    {inputImages.map((img, idx) => (
                        <div key={idx} className="relative shrink-0 w-16 h-16 border border-black group">
                            <img src={img} className="w-full h-full object-cover" />
                            <button 
                                onClick={() => removeImage(idx)}
                                className="absolute -top-2 -right-2 bg-red-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shadow-sm opacity-0 group-hover:opacity-100"
                            >
                                &times;
                            </button>
                        </div>
                    ))}
                    {inputImages.length > 1 && (
                        <button onClick={clearImages} className="text-xs underline text-red-600 font-bold uppercase self-center">Clear All</button>
                    )}
                </div>
            )}
            
            <div className="relative flex items-center justify-center w-full my-4">
                 <div className="border-t-2 border-gray-200 w-full absolute"></div>
                 <span className="bg-gray-50 px-3 text-xs font-bold text-gray-400 uppercase relative z-10">{t.inputs.or_separator}</span>
            </div>

            {/* Inputs */}
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-bold mb-1 uppercase">{t.inputs.desc_label}</label>
                    <input
                        type="text"
                        value={descPrompt}
                        onChange={(e) => setDescPrompt(e.target.value)}
                        placeholder={t.inputs.desc_placeholder}
                        className="w-full px-3 border-2 border-black focus:outline-none focus:ring-0 rounded-none text-base placeholder-gray-400 bg-white h-10"
                        disabled={isLoading}
                    />
                </div>
                <div>
                    <label className="block text-sm font-bold mb-1 uppercase">{t.inputs.style_label}</label>
                    <input
                        type="text"
                        value={stylePrompt}
                        onChange={(e) => setStylePrompt(e.target.value)}
                        placeholder={t.inputs.style_placeholder}
                        className="w-full px-3 border-2 border-black focus:outline-none focus:ring-0 rounded-none text-base placeholder-gray-400 bg-white h-10"
                        disabled={isLoading}
                    />
                </div>
                <div>
                    <label className="block text-sm font-bold mb-1 uppercase">{t.inputs.anim_label}</label>
                    <input
                        type="text"
                        value={animPrompt}
                        onChange={(e) => setAnimPrompt(e.target.value)}
                        placeholder={t.inputs.anim_placeholder}
                        className="w-full px-3 border-2 border-black focus:outline-none focus:ring-0 rounded-none text-base placeholder-gray-400 bg-white h-10"
                        disabled={isLoading}
                    />
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 items-end mt-4">
                <div className="w-full sm:w-40 flex-shrink-0">
                    <label htmlFor="aspect" className="block text-sm font-bold mb-2 uppercase">
                    {t.inputs.aspect_ratio}
                    </label>
                    <select
                        id="aspect"
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value)}
                        disabled={isLoading}
                        className="w-full px-3 border-2 border-black focus:outline-none rounded-none bg-white h-12"
                    >
                        {ASPECT_RATIOS.map(ratio => (
                            <option key={ratio} value={ratio}>{ratio}</option>
                        ))}
                    </select>
                </div>
            
                <div className="flex flex-col sm:flex-row flex-grow justify-end items-center gap-6 w-full">
                    <label 
                        className="flex items-center cursor-pointer select-none"
                        title={`Add instruction: ${IMAGE_SYSTEM_PROMPT}`}
                    >
                        <div className="relative">
                        <input
                            type="checkbox"
                            className="sr-only"
                            checked={useOptimization}
                            onChange={(e) => setUseOptimization(e.target.checked)}
                            disabled={isLoading}
                        />
                        <div className={`block w-10 h-6 border-2 border-black ${useOptimization ? 'bg-black' : 'bg-gray-500'}`}></div>
                        <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 transition-transform ${useOptimization ? 'translate-x-4' : ''}`}></div>
                        </div>
                        <div className="ml-3 text-sm font-bold uppercase">{t.inputs.optimize_scene}</div>
                    </label>

                    <button
                        type="button"
                        onClick={handleImageGenerate}
                        disabled={isLoading || !descPrompt.trim()}
                        className="w-full sm:w-40 h-12 bg-black text-white border-2 border-black font-bold uppercase hover:bg-gray-900 disabled:opacity-50 transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,0.5)] active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)] text-sm whitespace-nowrap"
                    >
                        {status === 'generating_image' ? t.status.generating_image : t.buttons.generate}
                    </button>
                </div>
            </div>
            </div>
        )}

        {/* Error Message */}
        {errorMsg && (
          <div className="p-4 border-2 border-red-500 bg-red-50 text-red-700 text-sm font-bold animate-in fade-in" role="alert">
            {t.status.error}: {errorMsg}
          </div>
        )}

        {/* Viewer */}
        <div className="space-y-2">
            {isViewerVisible && (
            <div className="w-full aspect-square border-2 border-black relative bg-gray-50 flex items-center justify-center overflow-hidden shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            
            {isLoading && (
                <div className="absolute inset-0 bg-white z-20 flex flex-col items-start justify-center p-8 sm:p-12 overflow-hidden">
                    <div className="w-full max-w-3xl mb-10 text-xl font-bold tracking-tight">
                        {status === 'generating_image' ? t.viewer.loading_image : t.viewer.loading_voxels}
                    </div>
                    <div className="w-full max-w-3xl opacity-70 font-mono text-xs sm:text-sm whitespace-pre-wrap break-words max-h-[40%] overflow-y-auto">
                        {thinkingText ? (
                            <span>{thinkingText}<span className="loading-dots"></span></span>
                        ) : (
                            <span className="loading-dots">{t.viewer.thinking}</span>
                        )}
                    </div>
                </div>
            )}

            {!currentImageData && !voxelCode && !isLoading && status !== 'error' && (
                <div className="text-gray-400 text-center px-6 pointer-events-none">
                <p className="text-lg">{t.viewer.placeholder}</p>
                </div>
            )}

            {/* Image Viewer with navigation if multiple */}
            {viewMode === 'image' && currentImageData && (
                <div className="relative w-full h-full group">
                    <img src={currentImageData} alt="Displayed" className="w-full h-full object-contain" />
                    {inputImages.length > 1 && (
                        <>
                             <button 
                                onClick={() => setDisplayedImageIndex(i => (i > 0 ? i - 1 : inputImages.length - 1))}
                                className="absolute left-2 top-1/2 -translate-y-1/2 bg-white border-2 border-black p-2 hover:bg-gray-100 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                             >
                                &lt;
                             </button>
                             <button 
                                onClick={() => setDisplayedImageIndex(i => (i < inputImages.length - 1 ? i + 1 : 0))}
                                className="absolute right-2 top-1/2 -translate-y-1/2 bg-white border-2 border-black p-2 hover:bg-gray-100 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                             >
                                &gt;
                             </button>
                             <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black text-white px-2 py-1 text-xs font-bold">
                                {displayedImageIndex + 1} / {inputImages.length}
                             </div>
                        </>
                    )}
                </div>
            )}

            {voxelCode && viewMode === 'voxel' && (
                <iframe
                ref={iframeRef}
                title="Voxel Scene"
                srcDoc={voxelCode}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-popups allow-pointer-lock allow-modals allow-downloads"
                />
            )}
            </div>
            )}

            {/* Action Buttons  */}
            {isViewerVisible && (
            <div className="flex flex-wrap gap-4 pt-4">
            {currentImageData && voxelCode && (
                <button
                type="button"
                onClick={() => setViewMode(viewMode === 'image' ? 'voxel' : 'image')}
                disabled={isLoading}
                className="flex-1 min-w-[140px] py-4 border-2 border-black bg-white font-bold uppercase transition-all duration-200 disabled:opacity-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-gray-50 hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                >
                {viewMode === 'image' ? t.buttons.view_scene : t.buttons.view_image}
                </button>
            )}

            {((viewMode === 'image' && currentImageData) || (viewMode === 'voxel' && voxelCode)) && (
                <>
                <button
                type="button"
                onClick={handleDownload}
                disabled={isLoading}
                className="flex-1 min-w-[140px] py-4 border-2 border-black bg-white font-bold uppercase transition-all duration-200 disabled:opacity-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-gray-50 hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                >
                {viewMode === 'image' ? t.buttons.download_img : t.buttons.export_html}
                </button>
                
                {viewMode === 'voxel' && (
                    <>
                        <button
                        type="button"
                        onClick={handleGLBDownload}
                        disabled={isLoading}
                        className="flex-1 min-w-[140px] py-4 border-2 border-black bg-white font-bold uppercase transition-all duration-200 disabled:opacity-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-gray-50 hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        title="Export for Blender/Unity"
                        >
                        GLB (3D)
                        </button>
                        
                        <button
                            type="button"
                            onClick={handleCopyEmbed}
                            disabled={isLoading}
                            className="flex-1 min-w-[140px] py-4 border-2 border-black bg-white font-bold uppercase transition-all duration-200 disabled:opacity-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-gray-50 hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                            >
                            {t.buttons.copy_code}
                        </button>
                   </>
                )}
                </>
            )}
            
            {(inputImages.length > 0 || voxelCode) && (
                <button
                type="button"
                onClick={handleVoxelize}
                disabled={isLoading}
                className="flex-1 min-w-[160px] py-4 bg-black text-white border-2 border-black font-bold uppercase disabled:opacity-50 transition-all duration-200 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)] hover:bg-gray-900 hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,0.5)] active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)]"
                >
                {voxelCode ? (inputImages.length > 0 ? "Update Scene" : t.buttons.regenerate) : t.buttons.generate_voxels}
                </button>
            )}
            </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default App;