

export interface Translation {
  title: string;
  subtitle: string;
  status: {
    idle: string;
    generating_image: string;
    generating_voxels: string;
    error: string;
  };
  buttons: {
    load_example: string;
    generate_new: string;
    view_scene: string;
    view_image: string;
    download_img: string;
    export_html: string;
    export_glb: string;
    copy_code: string;
    generate_voxels: string;
    regenerate: string;
    generate: string;
    gen_image_2d: string;
    gen_voxel_3d: string;
    close: string;
    editing: string;
    paste_image: string;
    open_editor: string;
  };
  inputs: {
    desc_label: string;
    desc_placeholder: string;
    style_label: string;
    style_placeholder: string;
    anim_label: string;
    anim_placeholder: string;
    aspect_ratio: string;
    optimize_scene: string;
    optimize_tooltip: string;
    upload_text: string;
    or_separator: string;
    drag_drop: string;
  };
  modal: {
    gen_title: string;
    gen_body: string;
    btn_2d: string;
    btn_3d: string;
    btn_cancel: string;
  };
  viewer: {
    loading_image: string;
    loading_voxels: string;
    thinking: string;
    placeholder: string;
  };
  controls: {
    mode_orbit: string;
    mode_fly: string;
    speed: string;
    help_text: string;
    toggle_fullscreen: string;
  };
  editor: {
    undo: string;
    redo: string;
    pause: string;
    play: string;
    select: string;
    move: string;
    rotate: string;
    scale: string;
    build: string;
    break: string;
    pipette: string;
    layers: string;
    size: string;
    ctx_delete: string;
    ctx_clone: string;
    ctx_focus: string;
  };
}