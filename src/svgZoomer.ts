import { Point } from "./types.js";

export function addDragZoomCapabilities(svg: HTMLElement, initialViewBox = { x: 0, y: 0, w: 640, h: 480 }) {

    // Pan & zoom
    let viewBox = { ...initialViewBox };
    let isPanning = false;
    let start = new Point(0, 0);

    svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);

    svg.addEventListener('mousedown', (e) => {
      isPanning = true;
      start.x = e.clientX;
      start.y = e.clientY;
      svg.style.cursor = 'grabbing';
    });

    svg.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      const dx = (e.clientX - start.x) * viewBox.w / svg.clientWidth;
      const dy = (e.clientY - start.y) * viewBox.h / svg.clientHeight;
      viewBox.x -= dx;
      viewBox.y -= dy;
      svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
      start.x = e.clientX;
      start.y = e.clientY;
    });

    svg.addEventListener('mouseup', () => { isPanning = false; svg.style.cursor = 'grab'; });
    svg.addEventListener('mouseleave', () => { isPanning = false; svg.style.cursor = 'grab'; });

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scale = 1.1;
      const zoom = e.deltaY < 0 ? 1 / scale : scale;
      const fx = e.offsetX / svg.clientWidth;
      const fy = e.offsetY / svg.clientHeight;
      const mx = fx * viewBox.w + viewBox.x;
      const my = fy * viewBox.h + viewBox.y;
      viewBox.w *= zoom;
      viewBox.h *= zoom;
      viewBox.x = mx - fx * viewBox.w;
      viewBox.y = my - fy * viewBox.h;
      svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
    });

}
