import type {Node} from '@xyflow/react';

/** Layout unmodified automatic outputs without anchoring on a manually moved slot. */
export function automaticOutputGridPositions(nodes:Node[], edges:Array<{id:string;source:string;target:string}>) {
  const REORDER_GAP=30, REORDER_COLS=3;
  // 按 source 分组收集自动外挂的 OutputNode
  const groups = new Map<string, Node[]>();
  for (const e of edges) {
    if (!e.id.startsWith('e-auto-')) continue;
    const target = nodes.find((n) => n.id === e.target);
    if (!target || target.type !== 'output') continue;
    if (!target.id.startsWith('output-auto-')) continue;
    let g = groups.get(e.source);
    if (!g) {
      g = [];
      groups.set(e.source, g);
    }
    g.push(target);
  }
  if (groups.size === 0) return new Map<string, {x:number;y:number}>();

  const updates = new Map<string, { x: number; y: number }>();
  for (const [srcId, list] of groups) {
    const src = nodes.find((n) => n.id === srcId);
    if (!src) continue;
    // 按 pickIndex 排序, 保证顺序与上游输出一致
    list.sort((a, b) => {
      const ai = (a.data as any)?.pickIndex ?? 0;
      const bi = (b.data as any)?.pickIndex ?? 0;
      return ai - bi;
    });
    // measured 优先, 未渲染出来前回退到占位尺寸
    const dims = list.map((n) => ({
      w: (n as any).measured?.width || (n as any).width || 320,
      h: (n as any).measured?.height || (n as any).height || 360,
    }));
    const rowsCount = Math.ceil(list.length / REORDER_COLS);
    const colMaxW = new Array(REORDER_COLS).fill(0);
    const rowMaxH = new Array(rowsCount).fill(0);
    list.forEach((_, i) => {
      const c = i % REORDER_COLS;
      const r = Math.floor(i / REORDER_COLS);
      if (dims[i].w > colMaxW[c]) colMaxW[c] = dims[i].w;
      if (dims[i].h > rowMaxH[r]) rowMaxH[r] = dims[i].h;
    });
    // 累加出各列 / 各行 的起点偏移
    const colX = new Array(REORDER_COLS).fill(0);
    for (let c = 1; c < REORDER_COLS; c++) {
      colX[c] = colX[c - 1] + colMaxW[c - 1] + REORDER_GAP;
    }
    const rowY = new Array(rowsCount).fill(0);
    for (let r = 1; r < rowsCount; r++) {
      rowY[r] = rowY[r - 1] + rowMaxH[r - 1] + REORDER_GAP;
    }
    const srcW = (src as any).measured?.width || (src as any).width || 320;
    const srcH = (src as any).measured?.height || (src as any).height || 360;
    // v1.2.10.5-hotfix4: reorder 只负责内部网格对齐，不做碰撞避让（避让是 autoOutput 的职责）。
    // 用第一个节点的当前位置作为锚点，保留 autoOutput 算好的偏移，避免无限循环。
    const naturalBaseX = (src.position?.x ?? 0) + srcW + 80;
    // v1.2.10.7: naturalBaseY 对齐源节点垂直中心
    const _totalGridH = rowY[rowsCount - 1] + rowMaxH[rowsCount - 1];
    const naturalBaseY = (src.position?.y ?? 0) + srcH / 2 - _totalGridH / 2;
    // A manually moved/dragging output is independent, including the first
    // output. Infer the existing grid origin from an untouched slot instead.
    const anchorIndex = list.findIndex((item) => (item.data as any)?.userMoved !== true && !item.dragging);
    if (anchorIndex < 0) continue;
    const anchor = list[anchorIndex];
    const baseX = (anchor.position?.x ?? naturalBaseX) - colX[anchorIndex % REORDER_COLS];
    const baseY = (anchor.position?.y ?? naturalBaseY) - rowY[Math.floor(anchorIndex / REORDER_COLS)];
    // 内部网格布局：直接用 baseX + colX/rowY 对齐，不做外部碰撞检测（避免无限循环）
    list.forEach((n, i) => {
      const c = i % REORDER_COLS;
      const r = Math.floor(i / REORDER_COLS);
      const newX = baseX + colX[c];
      const newY = baseY + rowY[r];
      const cx = n.position?.x ?? 0;
      const cy = n.position?.y ?? 0;
      // 用户手动拖动过的节点 (data.userMoved=true) 跳过, 保留位置
      if ((n.data as any)?.userMoved === true || n.dragging) return;
      // 误差大于 1px 才修正, 避免微量抖动触发无限重渲染
      if (Math.abs(cx - newX) > 1 || Math.abs(cy - newY) > 1) {
        updates.set(n.id, { x: newX, y: newY });
      }
    });
  }
return updates;
}
