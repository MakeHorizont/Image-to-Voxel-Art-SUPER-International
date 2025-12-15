
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useState, useRef, useEffect } from 'react';
import { generateImage, generateVoxelScene, IMAGE_SYSTEM_PROMPT, VOXEL_PROMPT } from './services/gemini';
import { extractHtmlFromText, hideBodyText, exposeThreeJSObjects, injectGameControls, updateCameraSettings, injectVoxelEditor, VOXEL_EDITOR_START, VOXEL_EDITOR_END } from './utils/html';
import { languages, defaultLanguage, LanguageCode } from './languages';

type AppStatus = 'idle' | 'generating_image' | 'generating_voxels' | 'error';

const APP_VERSION = "v1.5.0";

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

// Inline SVG placeholders to ensure reliability (no external fetch errors)
const THUMB_1 = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%23ffebd0'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-weight='bold' font-size='40' fill='%235c4033' dominant-baseline='middle' text-anchor='middle'%3ESakura Island%3C/text%3E%3C/svg%3E`;
const THUMB_2 = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%2387CEEB'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-weight='bold' font-size='40' fill='%23E69F46' dominant-baseline='middle' text-anchor='middle'%3EVoxel Cat%3C/text%3E%3C/svg%3E`;
const THUMB_3 = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%2387CEEB'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-weight='bold' font-size='40' fill='%23B83228' dominant-baseline='middle' text-anchor='middle'%3EZen Garden%3C/text%3E%3C/svg%3E`;

const EXAMPLES: Example[] = [
  { img: THUMB_1, html: '/examples/example1.html' },
  { img: THUMB_2, html: '/examples/example2.html' },
  { img: THUMB_3, html: '/examples/example3.html' },
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
  const [showGenConfirm, setShowGenConfirm] = useState(false);

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

  // Editor State
  const [isEditorActive, setIsEditorActive] = useState(false);

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
            // For data URIs, we don't strictly need fetch, but this keeps logic consistent
            // and allows mixed content types if we revert to URLs later.
            if (ex.img.startsWith('data:')) {
                loaded[ex.img] = ex.img;
            } else {
                const response = await fetch(ex.img);
                if (response.ok) {
                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    createdUrls.push(url);
                    loaded[ex.img] = url;
                }
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

  const onGenerateImageClick = () => {
      if (!descPrompt.trim()) return;
      setShowGenConfirm(true);
  };

  const confirmImageGeneration = async () => {
    setShowGenConfirm(false);
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
    setIsEditorActive(false);
    
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
      setIsEditorActive(false);
      
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
    setIsEditorActive(false);
    
    try {
      // 1. Load Image (from data URI or fetch)
      let base64Img = example.img;
      if (!base64Img.startsWith('data:')) {
           const imgResponse = await fetch(example.img);
           if (!imgResponse.ok) throw new Error(`Failed to load example image: ${imgResponse.statusText}`);
           const imgBlob = await imgResponse.blob();
           base64Img = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(imgBlob);
          });
      }

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
          setIsEditorActive(false);

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
    // Dismiss modal if triggered from there
    if (showGenConfirm) setShowGenConfirm(false);

    // Allow generation if there is either an image OR a text description OR existing voxel code
    if (inputImages.length === 0 && !voxelCode && !descPrompt.trim()) {
        return;
    }

    setStatus('generating_voxels');
    setErrorMsg('');
    setThinkingText(null);
    setIsViewerVisible(true);
    setIsEditorActive(false);
    
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
      setShowGenerator(false); // Auto close generator on success
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
    
    // STRIP EDITOR CODE
    // We remove the injected editor script so the downloaded file is just a viewer.
    if (codeToExport.includes(VOXEL_EDITOR_START)) {
        // Regex to match everything between START and END markers including markers
        const regex = new RegExp(`${VOXEL_EDITOR_START}[\\s\\S]*?${VOXEL_EDITOR_END}`, 'g');
        codeToExport = codeToExport.replace(regex, '');
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

  const handleToggleEditor = () => {
      if (!voxelCode || viewMode !== 'voxel') return;

      if (!isEditorActive) {
          // ACTIVATE EDITOR
          const codeWithEditor = injectVoxelEditor(voxelCode, t);
          setVoxelCode(codeWithEditor);
          setIsEditorActive(true);
      } else {
          // We can't easily "remove" the editor script once injected without reloading the iframe, 
          // but clicking this again effectively does nothing in this MVP except maybe we could reload the original code.
          // For now, let's just alert.
          alert("Editor is active. To close it, reload the scene or generate a new one.");
      }
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
            
            {/* Modal for Generation Type Confirmation */}
            {showGenConfirm && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-white bg-opacity-95 p-4 animate-in fade-in">
                    <div className="max-w-md text-center space-y-6">
                        <h3 className="text-2xl font-black uppercase">{t.modal.gen_title}</h3>
                        <p className="text-lg font-medium text-gray-700 whitespace-pre-wrap">{t.modal.gen_body}</p>
                        <div className="flex flex-col gap-3">
                             <button
                                onClick={confirmImageGeneration}
                                className="w-full py-3 bg-black text-white border-2 border-black font-bold uppercase hover:bg-gray-800 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,0.3)] active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)]"
                             >
                                {t.modal.btn_2d}
                             </button>
                             <button
                                onClick={handleVoxelize}
                                className="w-full py-3 bg-white text-black border-2 border-black font-bold uppercase hover:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,0.3)] active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)]"
                             >
                                {t.modal.btn_3d}
                             </button>
                             <button
                                onClick={() => setShowGenConfirm(false)}
                                className="text-sm underline font-bold uppercase text-gray-500 mt-2 hover:text-black"
                             >
                                {t.modal.btn_cancel}
                             </button>
                        </div>
                    </div>
                </div>
            )}

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
                        className="flex items-center cursor-pointer select-none group relative"
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
                        <div className="ml-3 text-sm font-bold uppercase flex items-center gap-2">
                             {t.inputs.optimize_scene}
                             {/* Tooltip Icon */}
                             <div className="relative group/tooltip" title={t.inputs.optimize_tooltip}>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-gray-500 hover:text-black">
                                     <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                                </svg>
                             </div>
                        </div>
                    </label>
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 pt-4">
                <button
                    onClick={onGenerateImageClick}
                    disabled={isLoading || (!descPrompt && inputImages.length === 0)}
                    className="w-full py-4 bg-black text-white border-2 border-black font-black text-lg uppercase tracking-wider hover:bg-gray-800 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,0.3)] active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    {isLoading ? t.status.generating_image : t.buttons.gen_image_2d}
                </button>

                 <div className="relative flex items-center justify-center w-full my-2">
                     <div className="border-t border-gray-300 w-full absolute"></div>
                     <span className="bg-gray-50 px-2 text-xs font-bold text-gray-400 uppercase relative z-10">{t.inputs.or_separator}</span>
                </div>

                <button
                    onClick={handleVoxelize}
                    disabled={isLoading || (!descPrompt && inputImages.length === 0 && !voxelCode)}
                    className="w-full py-6 bg-gradient-to-r from-blue-600 to-blue-700 text-white border-2 border-black font-black text-xl uppercase tracking-wider shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1"
                >
                    <span>{t.buttons.gen_voxel_3d}</span>
                    <span className="text-xs font-normal opacity-80 normal-case tracking-normal">Gemini 3 Pro + Three.js</span>
                </button>
            </div>

            </div>
        )}

        {/* Viewer Section */}
        {isViewerVisible && (
        <div className={`relative w-full aspect-square border-2 border-black bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group overflow-hidden ${isLoading ? 'animate-pulse' : ''}`}>
           {/* Status Overlay */}
           {isLoading && (
               <div className="absolute inset-0 z-20 bg-white bg-opacity-90 flex flex-col items-center justify-center p-6 text-center">
                   <div className="text-6xl mb-4 animate-bounce">🧊</div>
                   <h2 className="text-2xl font-black uppercase mb-2 loading-dots">
                       {status === 'generating_image' ? t.viewer.loading_image : t.viewer.loading_voxels}
                   </h2>
                   {thinkingText && (
                       <div className="max-w-md mt-4 p-3 bg-gray-100 border-l-4 border-black text-left text-sm font-mono text-gray-600 italic">
                           <span className="font-bold not-italic mr-2">🤖 {t.viewer.thinking}:</span>
                           {thinkingText}...
                       </div>
                   )}
               </div>
           )}

           {/* Error Overlay */}
           {status === 'error' && (
               <div className="absolute inset-0 z-30 bg-red-50 flex flex-col items-center justify-center p-6 text-center text-red-600">
                   <div className="text-5xl mb-4">⚠️</div>
                   <h3 className="text-xl font-bold uppercase mb-2">Error</h3>
                   <p className="max-w-md">{errorMsg}</p>
                   <button onClick={() => setStatus('idle')} className="mt-6 px-6 py-2 border-2 border-red-600 font-bold uppercase hover:bg-red-100">
                       Dismiss
                   </button>
               </div>
           )}
           
           {/* Content */}
           {viewMode === 'image' ? (
                currentImageData ? (
                    <img src={currentImageData} alt="Generated" className="w-full h-full object-contain" />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 p-8 text-center">
                        <div className="text-4xl mb-2 opacity-30">🖼️</div>
                        <p className="font-bold uppercase opacity-50">{t.viewer.placeholder}</p>
                        <p className="text-xs mt-2 opacity-40">"{SAMPLE_PROMPTS[placeholderIndex]}"</p>
                    </div>
                )
           ) : (
                voxelCode && (
                    <iframe
                        ref={iframeRef}
                        srcDoc={voxelCode}
                        className="w-full h-full border-none"
                        title="Voxel Scene"
                        sandbox="allow-scripts allow-same-origin allow-downloads allow-pointer-lock"
                    />
                )
           )}

           {/* Viewer Actions Overlay (Hover) */}
           {!isLoading && (currentImageData || voxelCode) && (
             <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                <div className="pointer-events-auto flex flex-col gap-2">
                    {/* View Switcher */}
                    {inputImages.length > 0 && voxelCode && (
                        <button 
                            onClick={() => setViewMode(viewMode === 'image' ? 'voxel' : 'image')}
                            className="p-2 bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all"
                            title="Switch View"
                        >
                           {viewMode === 'image' ? '📦 ' + t.buttons.view_scene : '🖼️ ' + t.buttons.view_image}
                        </button>
                    )}
                    
                    {/* Editor Toggle (Only for Voxel Mode) */}
                    {viewMode === 'voxel' && voxelCode && (
                         <button 
                            onClick={handleToggleEditor}
                            className={`p-2 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all ${isEditorActive ? 'bg-black text-white' : 'bg-white'}`}
                            title={t.buttons.open_editor}
                        >
                           🛠️ {t.buttons.open_editor}
                        </button>
                    )}

                    {/* Download Image */}
                    {viewMode === 'image' && (
                        <button 
                            onClick={handleDownload}
                            className="p-2 bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all"
                            title={t.buttons.download_img}
                        >
                           💾 {t.buttons.download_img}
                        </button>
                    )}

                    {/* Export HTML */}
                    {viewMode === 'voxel' && (
                        <button 
                            onClick={handleDownload}
                            className="p-2 bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all"
                            title={t.buttons.export_html}
                        >
                           🌐 {t.buttons.export_html}
                        </button>
                    )}

                     {/* Export GLB */}
                     {viewMode === 'voxel' && (
                        <button 
                            onClick={handleGLBDownload}
                            className="p-2 bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all"
                            title={t.buttons.export_glb}
                        >
                           🧊 {t.buttons.export_glb}
                        </button>
                    )}
                    
                    {/* Regenerate Code */}
                    {selectedTile === 'user' && voxelCode && (
                        <button 
                            onClick={() => { setShowGenerator(true); setIsViewerVisible(false); }}
                            className="p-2 bg-yellow-300 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all font-bold"
                            title="Regenerate/Edit"
                        >
                           🔄 {t.buttons.regenerate}
                        </button>
                    )}
                </div>
             </div>
           )}
        </div>
        )}
      </div>
    </div>
  );
};

export default App;
