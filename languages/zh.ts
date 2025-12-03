
import { Translation } from './types';

export const zh: Translation = {
  title: "图像转体素艺术",
  subtitle: "使用 Gemini 3，从任何图像创建体素艺术场景。",
  status: {
    idle: "空闲",
    generating_image: "正在生成图像...",
    generating_voxels: "正在生成体素...",
    error: "错误",
  },
  buttons: {
    load_example: "加载示例",
    generate_new: "生成新图像",
    view_scene: "查看场景",
    view_image: "查看图像",
    download_img: "下载图片",
    export_html: "导出 HTML",
    copy_code: "复制代码",
    generate_voxels: "生成体素",
    regenerate: "重新生成",
    generate: "生成",
    close: "关闭",
    editing: "编辑中",
    paste_image: "粘贴图片",
  },
  inputs: {
    desc_label: "1) 对象描述",
    desc_placeholder: "例如：海底的树屋",
    style_label: "2) 风格",
    style_placeholder: "例如：体素艺术，赛博朋克，暖光",
    anim_label: "3) 动画和交互",
    anim_placeholder: "例如：漂浮的鱼，摇曳的海草",
    aspect_ratio: "纵横比",
    optimize_scene: "优化场景",
    upload_text: "上传图片",
    or_separator: "或",
    drag_drop: "拖放、点击或粘贴 (Ctrl+V)",
  },
  viewer: {
    loading_image: "正在使用 Gemini 2.5 Flash Image 生成 three.js 场景",
    loading_voxels: "正在使用 Gemini 3 Pro 生成 three.js 场景",
    thinking: "思考中",
    placeholder: "选择一个示例，或生成你自己的！",
  },
  controls: {
    mode_orbit: "模式：轨道 🔄",
    mode_fly: "模式：飞行 ✈️",
    speed: "速度：",
    help_text: "<b>飞行控制：</b><br>WASD / 箭头移动<br>按住左键 + 拖动查看<br>Q/E 上升/下降<br>支持游戏手柄",
    toggle_fullscreen: "全屏切换",
  }
};
