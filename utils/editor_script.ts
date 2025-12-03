


/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// This string contains the entire JS logic for the in-browser Voxel Editor.
// It is injected into the iframe as a module.

export const EDITOR_SCRIPT = `
// --- VOXEL EDITOR MODULE ---
(async function() {
    console.log("🛠️ Initializing Voxel Editor...");

    const L = window.VE_LANG || {
        undo: "Undo", redo: "Redo", pause: "Pause", play: "Play",
        select: "Select", move: "Move", rotate: "Rotate", scale: "Scale",
        build: "Build", break: "Break", pipette: "Pipette", layers: "Layers",
        size: "Size", ctx_delete: "Delete", ctx_clone: "Clone", ctx_focus: "Focus"
    };

    // 1. Dependencies Check & Imports
    if (!window.THREE || !window.scene || !window.camera || !window.renderer) {
        console.error("Editor init failed: Three.js globals missing.");
        alert("Editor Error: Scene not ready. Please wait or regenerate.");
        return;
    }

    const THREE = window.THREE;
    let TransformControls;
    
    try {
        // Dynamic import of TransformControls from the same CDN as the map
        const mod = await import('three/addons/controls/TransformControls.js');
        TransformControls = mod.TransformControls;
    } catch (e) {
        console.error("Failed to load TransformControls", e);
        alert("Could not load editor tools (TransformControls missing).");
        return;
    }

    // --- COMMAND HISTORY (Undo/Redo) ---
    class CommandManager {
        constructor() {
            this.history = [];
            this.index = -1;
        }

        execute(cmd) {
            cmd.execute();
            // Clear future if we were in the middle
            if (this.index < this.history.length - 1) {
                this.history = this.history.slice(0, this.index + 1);
            }
            this.history.push(cmd);
            this.index++;
            updateUI();
        }

        undo() {
            if (this.index >= 0) {
                this.history[this.index].undo();
                this.index--;
                updateUI();
            }
        }

        redo() {
            if (this.index < this.history.length - 1) {
                this.index++;
                this.history[this.index].execute();
                updateUI();
            }
        }
    }

    const history = new CommandManager();

    // Commands
    class AddVoxelCommand {
        constructor(parent, voxel) {
            this.parent = parent;
            this.voxel = voxel;
        }
        execute() { this.parent.add(this.voxel); updateTree(); }
        undo() { this.parent.remove(this.voxel); updateTree(); }
    }

    class RemoveVoxelCommand {
        constructor(parent, voxel) {
            this.parent = parent;
            this.voxel = voxel;
        }
        execute() { 
            this.parent.remove(this.voxel); 
            if(state.selectedObject === this.voxel) selectObject(null);
            updateTree(); 
        }
        undo() { this.parent.add(this.voxel); updateTree(); }
    }

    class TransformCommand {
        constructor(object, oldState, newState) {
            this.object = object;
            this.oldState = oldState; // { pos, rot, scale }
            this.newState = newState;
        }
        execute() {
            this.object.position.copy(this.newState.position);
            this.object.quaternion.copy(this.newState.quaternion);
            this.object.scale.copy(this.newState.scale);
        }
        undo() {
            this.object.position.copy(this.oldState.position);
            this.object.quaternion.copy(this.oldState.quaternion);
            this.object.scale.copy(this.oldState.scale);
        }
    }

    // --- STATE ---
    const state = {
        activeTool: 'select', 
        selectedObject: null,
        hoveredVoxel: null, 
        brushColor: 0xffffff,
        brushSize: 1, // 1 to 5
        clipboard: null,
        isPaused: false,
        lastPipetteClick: 0
    };

    // --- UI STYLES ---
    const style = document.createElement('style');
    style.textContent = \`
        .ve-ui { font-family: 'Segoe UI', Roboto, sans-serif; box-sizing: border-box; user-select: none; }
        
        .ve-toolbar {
            position: fixed; top: 20px; left: 20px;
            background: #1e1e1e; border: 1px solid #333;
            border-radius: 8px; display: flex; flex-direction: column;
            padding: 8px; gap: 8px; box-shadow: 4px 4px 10px rgba(0,0,0,0.5);
            z-index: 10000;
        }
        
        .ve-tool-btn {
            width: 40px; height: 40px; border: none; background: transparent;
            color: #aaa; border-radius: 4px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            font-size: 20px; transition: all 0.2s; position: relative;
        }
        .ve-tool-btn:hover { background: #333; color: #fff; }
        .ve-tool-btn.active { background: #0078d4; color: #fff; }
        .ve-tool-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        .ve-color-picker {
            width: 30px; height: 30px; border-radius: 50%;
            border: 2px solid #fff; cursor: pointer; margin: 5px auto;
            overflow: hidden;
        }
        .ve-color-input { opacity: 0; width: 100%; height: 100%; cursor: pointer; }

        .ve-slider-container {
            padding: 4px; display: flex; flex-direction: column; align-items: center; color: #aaa; font-size: 10px;
        }
        .ve-slider { width: 30px; }

        .ve-panel {
            position: fixed; top: 20px; right: 20px;
            width: 250px; max-height: 80vh;
            background: #1e1e1e; border: 1px solid #333;
            border-radius: 8px; display: flex; flex-direction: column;
            color: #eee; font-size: 12px;
            box-shadow: 4px 4px 10px rgba(0,0,0,0.5);
            z-index: 10000;
        }
        .ve-panel-header {
            padding: 10px; background: #252526; border-bottom: 1px solid #333;
            font-weight: bold; display: flex; justify-content: space-between;
            border-radius: 8px 8px 0 0;
        }
        .ve-tree { overflow-y: auto; flex: 1; padding: 5px; }
        .ve-tree-item {
            padding: 4px 8px; cursor: pointer; display: flex; align-items: center;
            border-radius: 4px; gap: 6px;
        }
        .ve-tree-item:hover { background: #2a2d2e; }
        .ve-tree-item.selected { background: #37373d; color: #fff; border-left: 3px solid #0078d4; }
        .ve-tree-item.locked { opacity: 0.5; font-style: italic; }
        
        .ve-icon { width: 14px; text-align: center; opacity: 0.7; }
        .ve-lock-btn { margin-left: auto; cursor: pointer; padding: 2px; }
        .ve-lock-btn:hover { color: #fff; }
        
        /* Context Menu */
        .ve-ctx-menu {
            position: fixed; background: #252526; border: 1px solid #454545;
            min-width: 150px; z-index: 10002; display: none; box-shadow: 2px 2px 5px rgba(0,0,0,0.5);
        }
        .ve-ctx-item {
            padding: 8px 12px; cursor: pointer; color: #eee; font-size: 13px;
        }
        .ve-ctx-item:hover { background: #0078d4; }
    \`;
    document.head.appendChild(style);

    // --- UI CONSTRUCTION ---
    const toolbar = document.createElement('div');
    toolbar.className = 've-ui ve-toolbar';
    document.body.appendChild(toolbar);

    const panel = document.createElement('div');
    panel.className = 've-ui ve-panel';
    document.body.appendChild(panel);

    const ctxMenu = document.createElement('div');
    ctxMenu.className = 've-ui ve-ctx-menu';
    document.body.appendChild(ctxMenu);

    // Icons
    const icons = {
        Cursor: '<svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M7 2l12 11.2-5.8.5 3.3 7.3-2.2.9-3.2-7.4-4.4 4V2z"/></svg>',
        Move: '<svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z"/></svg>',
        Rotate: '<svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" transform="rotate(45 12 12)"/></svg>',
        Scale: '<svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z"/></svg>',
        Build: '<svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M4 4h16v16H4z M11 11H7v2h4v4h2v-4h4v-2h-4V7h-2v4z"/></svg>', 
        Break: '<svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M4 4h16v16H4z M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2"/></svg>',
        Pipette: '<svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M20.71 5.63l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L3 19.29V21h1.71l11.96-11.96 1.42 1.42 1.41-1.41-1.92-1.92 3.12-3.12c.39-.39.39-1.02 0-1.41z"/></svg>',
        Undo: '<svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>',
        Redo: '<svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M18.4 10.6C16.55 9 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>',
        Pause: '<svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
        Play: '<svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
    };

    // --- PAUSE LOGIC ---
    // Hack Three.js Clock to enable pause
    const originalGetDelta = THREE.Clock.prototype.getDelta;
    THREE.Clock.prototype.getDelta = function() {
        if (state.isPaused) return 0;
        return originalGetDelta.call(this);
    };

    function togglePause() {
        state.isPaused = !state.isPaused;
        const btn = document.getElementById('ve-btn-pause');
        if (btn) btn.innerHTML = state.isPaused ? icons.Play : icons.Pause;
        if (btn) btn.title = state.isPaused ? L.play : L.pause;
    }

    // --- TOOLS CONFIG ---
    function createBtn(id, icon, title, onClick) {
        const btn = document.createElement('button');
        btn.id = 've-btn-' + id;
        btn.className = 've-tool-btn';
        btn.innerHTML = icons[icon] || icon;
        btn.title = title;
        btn.onclick = onClick;
        return btn;
    }

    toolbar.appendChild(createBtn('undo', 'Undo', L.undo + ' (Ctrl+Z)', () => history.undo()));
    toolbar.appendChild(createBtn('redo', 'Redo', L.redo + ' (Ctrl+Shift+Z)', () => history.redo()));
    
    const pauseBtn = createBtn('pause', 'Pause', L.pause, togglePause);
    toolbar.appendChild(pauseBtn);

    const sep1 = document.createElement('div');
    sep1.style.cssText = 'height: 1px; background: #444; margin: 4px 0;';
    toolbar.appendChild(sep1);

    const toolDefs = [
        { id: 'select', icon: 'Cursor', label: L.select, key: 'v' },
        { id: 'move', icon: 'Move', label: L.move, key: 'g' },
        { id: 'rotate', icon: 'Rotate', label: L.rotate, key: 'r' },
        { id: 'scale', icon: 'Scale', label: L.scale, key: 's' },
        { separator: true },
        { id: 'build', icon: 'Build', label: L.build, key: 'b' },
        { id: 'break', icon: 'Break', label: L.break, key: 'x' },
        { id: 'pipette', icon: 'Pipette', label: L.pipette, key: 'i' },
    ];

    toolDefs.forEach(t => {
        if (t.separator) {
            const s = document.createElement('div');
            s.style.cssText = 'height: 1px; background: #444; margin: 4px 0;';
            toolbar.appendChild(s);
            return;
        }
        const btn = createBtn(t.id, t.icon, t.label, () => setTool(t.id));
        btn.dataset.tool = t.id;
        toolbar.appendChild(btn);
    });

    // Color Picker
    const colorDiv = document.createElement('div');
    colorDiv.className = 've-color-picker';
    colorDiv.style.backgroundColor = '#ffffff';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 've-color-input';
    colorInput.value = '#ffffff';
    colorInput.oninput = (e) => {
        state.brushColor = parseInt(e.target.value.replace('#', '0x'));
        colorDiv.style.backgroundColor = e.target.value;
    };
    colorDiv.appendChild(colorInput);
    toolbar.appendChild(colorDiv);

    // Brush Size Slider
    const sizeContainer = document.createElement('div');
    sizeContainer.className = 've-slider-container';
    sizeContainer.innerHTML = '<span>' + L.size + ': 1</span>';
    const sizeSlider = document.createElement('input');
    sizeSlider.type = 'range';
    sizeSlider.className = 've-slider';
    sizeSlider.min = '1'; sizeSlider.max = '5'; sizeSlider.step = '1'; sizeSlider.value = '1';
    sizeSlider.oninput = (e) => {
        state.brushSize = parseInt(e.target.value);
        sizeContainer.querySelector('span').innerText = L.size + ': ' + state.brushSize;
        updateGhostGeometry();
    };
    sizeContainer.appendChild(sizeSlider);
    toolbar.appendChild(sizeContainer);


    // Render Panel
    panel.innerHTML = \`
        <div class="ve-panel-header">
            <span>\${L.layers}</span>
        </div>
        <div class="ve-tree" id="ve-scene-tree"></div>
    \`;

    // --- HELPERS ---
    const controlGizmo = new TransformControls(window.camera, window.renderer.domElement);
    
    // Gizmo Event Handling (Start/End drag for undo)
    let gizmoStart = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() };
    
    controlGizmo.addEventListener('dragging-changed', (event) => {
        if (window.controls) window.controls.enabled = !event.value;
        
        if (event.value) {
            // Drag Start
            if(controlGizmo.object) {
                gizmoStart.position.copy(controlGizmo.object.position);
                gizmoStart.quaternion.copy(controlGizmo.object.quaternion);
                gizmoStart.scale.copy(controlGizmo.object.scale);
            }
        } else {
            // Drag End
            if(controlGizmo.object) {
                const newState = {
                    position: controlGizmo.object.position.clone(),
                    quaternion: controlGizmo.object.quaternion.clone(),
                    scale: controlGizmo.object.scale.clone()
                };
                history.execute(new TransformCommand(controlGizmo.object, gizmoStart, newState));
            }
        }
    });
    window.scene.add(controlGizmo);

    const selectionBox = new THREE.BoxHelper(undefined, 0xffff00);
    selectionBox.visible = false;
    window.scene.add(selectionBox);

    let ghostGeo = new THREE.BoxGeometry(1, 1, 1);
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5, wireframe: true });
    const ghostCursor = new THREE.Mesh(ghostGeo, ghostMat);
    ghostCursor.visible = false;
    window.scene.add(ghostCursor);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();


    function updateGhostGeometry() {
        const s = state.brushSize;
        ghostCursor.geometry.dispose();
        ghostCursor.geometry = new THREE.BoxGeometry(s, s, s);
    }

    function updateUI() {
        document.getElementById('ve-btn-undo').disabled = history.index < 0;
        document.getElementById('ve-btn-redo').disabled = history.index >= history.history.length - 1;
        
        document.querySelectorAll('.ve-tool-btn[data-tool]').forEach(b => {
            b.classList.toggle('active', b.dataset.tool === state.activeTool);
        });
    }

    function setTool(toolId) {
        state.activeTool = toolId;
        updateUI();

        if (toolId === 'move' || toolId === 'rotate' || toolId === 'scale') {
            if (state.selectedObject) {
                // If locked, do not attach
                if(state.selectedObject.userData.locked) {
                    controlGizmo.detach();
                } else {
                    controlGizmo.attach(state.selectedObject);
                    if (toolId === 'move') controlGizmo.setMode('translate');
                    if (toolId === 'rotate') controlGizmo.setMode('rotate');
                    if (toolId === 'scale') controlGizmo.setMode('scale');
                }
            }
        } else {
            controlGizmo.detach();
        }

        ghostCursor.visible = (toolId === 'build' || toolId === 'break');
    }

    function updateTree() {
        const tree = document.getElementById('ve-scene-tree');
        if (!tree) return;
        tree.innerHTML = '';
        
        // Flatten hierarchy slightly for readability or just show top level
        window.scene.children.forEach(obj => {
            if (obj === controlGizmo || obj === ghostCursor || obj === selectionBox) return;
            if (obj.type.includes('Light') || obj.type === 'CameraHelper') return;

            const el = document.createElement('div');
            el.className = 've-tree-item';
            if (obj === state.selectedObject) el.classList.add('selected');
            if (obj.userData.locked) el.classList.add('locked');
            
            const typeIcon = obj.isInstancedMesh ? '🧊' : (obj.isGroup ? '📁' : '📦');
            const name = obj.name || obj.type + ' ' + obj.id;
            
            // Icon + Name
            const info = document.createElement('span');
            info.innerHTML = \`<span class="ve-icon">\${typeIcon}</span><span>\${name}</span>\`;
            info.style.display = 'flex';
            info.style.gap = '6px';
            info.style.alignItems = 'center';
            el.appendChild(info);

            // Lock Button
            const lockBtn = document.createElement('span');
            lockBtn.className = 've-lock-btn';
            lockBtn.innerHTML = obj.userData.locked ? '🔒' : '🔓';
            lockBtn.title = obj.userData.locked ? 'Unlock' : 'Lock';
            lockBtn.onclick = (e) => {
                e.stopPropagation();
                obj.userData.locked = !obj.userData.locked;
                // If we lock the selected object, detach gizmo
                if (obj === state.selectedObject && obj.userData.locked) {
                    controlGizmo.detach();
                }
                updateTree();
            };
            el.appendChild(lockBtn);
            
            el.onmousedown = (e) => {
                if (e.button === 0) selectObject(obj);
                if (e.button === 2) showCtxMenu(e, obj);
            };
            
            tree.appendChild(el);
        });
    }

    function selectObject(obj) {
        state.selectedObject = obj;
        updateTree();
        
        if (obj) {
            selectionBox.setFromObject(obj);
            selectionBox.visible = true;
            
            if (obj.userData.locked) {
                 controlGizmo.detach();
            } else if (['move', 'rotate', 'scale'].includes(state.activeTool)) {
                controlGizmo.attach(obj);
            }
        } else {
            selectionBox.visible = false;
            controlGizmo.detach();
        }
    }

    // --- CONTEXT MENU ---
    function showCtxMenu(e, obj) {
        e.preventDefault();
        selectObject(obj);
        ctxMenu.style.display = 'block';
        ctxMenu.style.left = e.clientX + 'px';
        ctxMenu.style.top = e.clientY + 'px';
        
        ctxMenu.innerHTML = '';
        
        const isLocked = !!obj.userData.locked;

        const actions = [
            { label: L.ctx_delete, disabled: isLocked, action: () => { history.execute(new RemoveVoxelCommand(obj.parent || window.scene, obj)); } },
            { label: L.ctx_clone, disabled: isLocked, action: () => { 
                const clone = obj.clone(); 
                clone.position.addScalar(2); 
                history.execute(new AddVoxelCommand(obj.parent || window.scene, clone));
            }},
            { label: L.ctx_focus, action: () => { 
                if(window.controls) {
                    window.controls.target.copy(obj.position);
                    window.controls.update();
                }
            }},
        ];
        
        actions.forEach(a => {
            const el = document.createElement('div');
            el.className = 've-ctx-item';
            el.innerText = a.label;
            if (a.disabled) {
                el.style.opacity = '0.5';
                el.style.cursor = 'default';
            } else {
                el.onclick = () => { a.action(); ctxMenu.style.display = 'none'; };
            }
            ctxMenu.appendChild(el);
        });
    }

    window.addEventListener('click', () => { ctxMenu.style.display = 'none'; });

    // --- INTERACTION ---
    
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        
        // Undo/Redo
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) history.redo();
            else history.undo();
            return;
        }

        const key = e.key.toLowerCase();
        const tool = toolDefs.find(t => t.key === key);
        if (tool) setTool(tool.id);
        
        if (key === 'delete' || key === 'backspace') {
            if (state.selectedObject && !state.selectedObject.userData.locked) {
                 history.execute(new RemoveVoxelCommand(state.selectedObject.parent || window.scene, state.selectedObject));
            }
        }
    });

    window.renderer.domElement.addEventListener('mousemove', (e) => {
        const rect = window.renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        if (state.activeTool === 'build' || state.activeTool === 'break' || state.activeTool === 'pipette') {
            raycaster.setFromCamera(mouse, window.camera);
            const intersects = raycaster.intersectObjects(window.scene.children, true);
            const hit = intersects.find(i => i.object !== ghostCursor && i.object !== controlGizmo && i.object !== selectionBox && !i.object.isTransformControlsPlane && !i.object.userData.locked);

            if (hit) {
                const point = hit.point;
                const normal = hit.face.normal;
                
                // Align logic based on brush size
                const size = state.brushSize;
                const offset = size % 2 === 0 ? 0.0 : 0.5; // If even, snap to integer; if odd, snap to .5
                
                // But simplified: Just snap center to 1-unit grid.
                // Logic:
                // Build: Center = HitPoint + Normal * (Size/2)
                // Break: Center = HitPoint - Normal * (Size/2)
                
                const targetPos = point.clone();
                const shift = normal.clone().multiplyScalar(size * 0.5);
                
                if (state.activeTool === 'build') {
                    targetPos.add(shift);
                } else {
                    targetPos.sub(shift);
                }
                
                // Snap
                const sx = Math.round(targetPos.x);
                const sy = Math.round(targetPos.y);
                const sz = Math.round(targetPos.z);
                
                ghostCursor.position.set(sx, sy, sz);
                ghostCursor.visible = true;
                
                if (state.activeTool === 'break') ghostCursor.material.color.setHex(0xff0000);
                else ghostCursor.material.color.setHex(0x00ff00);

                state.hoveredVoxel = { x: sx, y: sy, z: sz, hitObj: hit.object, hitId: hit.instanceId };
            } else {
                ghostCursor.visible = false;
                state.hoveredVoxel = null;
            }
        }
    });

    window.renderer.domElement.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        
        // Double click detection for pipette
        const now = Date.now();
        const isDbl = (now - state.lastPipetteClick < 300);
        state.lastPipetteClick = now;

        if (state.activeTool === 'select') {
             raycaster.setFromCamera(mouse, window.camera);
             // Recursive true to find nested objects!
             const intersects = raycaster.intersectObjects(window.scene.children, true); 
             
             // Find first valid object that isn't gizmo/helper and isn't locked
             const hit = intersects.find(i => {
                 const o = i.object;
                 if (o === controlGizmo || o === selectionBox || o.isTransformControlsPlane) return false;
                 // Check if object or any parent is locked?
                 // For now, check direct object lock.
                 // Ideally check if parent is locked too.
                 let check = o;
                 while(check && check !== window.scene) {
                     if(check.userData && check.userData.locked) return false;
                     check = check.parent;
                 }
                 return true;
             });
             
             if (hit) {
                 // Traverse up to find a "selectable" parent if hit is just part of a group?
                 // But we want to select specifically what we clicked for precision.
                 selectObject(hit.object);
             } else {
                 selectObject(null);
             }
        }
        else if (state.activeTool === 'build' && state.hoveredVoxel) {
            const { x, y, z } = state.hoveredVoxel;
            const size = state.brushSize;
            
            const geometry = new THREE.BoxGeometry(size, size, size);
            const material = new THREE.MeshStandardMaterial({ color: state.brushColor });
            const voxel = new THREE.Mesh(geometry, material);
            voxel.position.set(x, y, z);
            voxel.castShadow = true;
            voxel.receiveShadow = true;
            voxel.name = "Voxel " + size;
            
            // Add to a UserLayer group
            let userLayer = window.scene.getObjectByName("UserLayer");
            if (!userLayer) {
                userLayer = new THREE.Group();
                userLayer.name = "UserLayer";
                window.scene.add(userLayer);
            }
            
            history.execute(new AddVoxelCommand(userLayer, voxel));
        }
        else if (state.activeTool === 'break' && state.hoveredVoxel) {
            const target = state.hoveredVoxel.hitObj;
            if (target.userData.locked) return; // Safety check

            if (!target.isInstancedMesh) {
                // If standard mesh, remove it
                history.execute(new RemoveVoxelCommand(target.parent || window.scene, target));
            } else {
                // InstancedMesh: Just hide it via scale matrix
                const id = state.hoveredVoxel.hitId;
                if (id !== undefined) {
                    const mat = new THREE.Matrix4();
                    target.getMatrixAt(id, mat);
                    
                    // Save old matrix for Undo
                    // This is complex for Command pattern without a dedicated InstancedMeshCommand.
                    // For MVP: Just scale to 0 and forget undo for InstancedMesh deletion
                    mat.makeScale(0,0,0);
                    target.setMatrixAt(id, mat);
                    target.instanceMatrix.needsUpdate = true;
                }
            }
        }
        else if (state.activeTool === 'pipette' && state.hoveredVoxel) {
             const target = state.hoveredVoxel.hitObj;
             let color;
             
             // Get Color
             if (target.isInstancedMesh) {
                 if (target.getColorAt) {
                     const c = new THREE.Color();
                     target.getColorAt(state.hoveredVoxel.hitId, c);
                     color = c;
                 }
             } else {
                 color = target.material.color;
             }
             
             if (color) {
                 state.brushColor = color.getHex();
                 colorInput.value = '#' + color.getHexString();
                 colorDiv.style.backgroundColor = colorInput.value;
             }

             // Get Size (Double Click)
             if (isDbl && !target.isInstancedMesh && target.geometry.type === 'BoxGeometry') {
                 // Estimate size from X scale or parameter
                 // Assume Uniform scale
                 const s = target.scale.x * (target.geometry.parameters.width || 1);
                 const rounded = Math.round(s);
                 if (rounded >= 1 && rounded <= 5) {
                     state.brushSize = rounded;
                     sizeSlider.value = rounded;
                     sizeContainer.querySelector('span').innerText = L.size + ': ' + rounded;
                     updateGhostGeometry();
                 }
             }
             
             // FIXED: Do not switch tool automatically
             // if (!isDbl) setTool('build'); 
        }
    });
    
    // Animation loop update for selection box
    const _anim = function() {
        requestAnimationFrame(_anim);
        if (selectionBox.visible && state.selectedObject) {
            selectionBox.update();
        }
    };
    _anim();

    updateTree();
    updateUI();
    console.log("🛠️ Voxel Editor Loaded");

})();
`;