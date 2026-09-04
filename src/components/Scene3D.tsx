import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Model } from '../types';
import { formatMetricValue, getMetric, METRIC_MAP, normalizeForDisplay } from '../metrics';
import { rampRgb } from '../ramp';
import Tooltip from './Tooltip';

export type ColorMode = 'metric' | 'creator';

export interface Scene3DHandle {
  getDataURL: () => string | null;
  resetView: () => void;
}

interface Props {
  models: Model[];
  xKey: string;
  yKey: string;
  zKey: string;
  sizeKey: string;
  colorKey: string;
  colorMode: ColorMode;
  selectedIds: string[];
  showLabels: boolean;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
  onOpen: (id: string) => void;
}

const SPAN = 1.15;

function rampColor(t: number): THREE.Color {
  const [r, g, b] = rampRgb(t);
  return new THREE.Color(r, g, b);
}

function makeLabel(text: string, color = '#e8ecf5', px = 40, bold = false): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `${bold ? '700' : '500'} ${px}px Inter, "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  const h = px + 16;
  canvas.width = w;
  canvas.height = h;
  const c2 = canvas.getContext('2d')!;
  c2.font = font;
  c2.textBaseline = 'middle';
  c2.fillStyle = 'rgba(8,11,18,0.72)';
  if (c2.roundRect) {
    c2.beginPath();
    c2.roundRect(0, 0, w, h, 8);
    c2.fill();
  } else {
    c2.fillRect(0, 0, w, h);
  }
  c2.fillStyle = color;
  c2.fillText(text, 10, h / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const scale = 0.0027;
  sprite.scale.set(w * scale, h * scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export const Scene3D = forwardRef<Scene3DHandle, Props>(function Scene3D(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const nodesRef = useRef<THREE.Mesh[]>([]);
  const nodeGroupRef = useRef<THREE.Group | null>(null);
  const labelsRef = useRef<THREE.Group | null>(null);
  const axesRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; id: string } | null>(null);

  // 供事件回调读取的最新 props
  const stateRef = useRef(props);
  stateRef.current = props;

  useImperativeHandle(ref, () => ({
    getDataURL: () => {
      const r = rendererRef.current;
      if (!r) return null;
      r.render(sceneRef.current!, cameraRef.current!);
      return r.domElement.toDataURL('image/png');
    },
    resetView: () => {
      const cam = cameraRef.current;
      const ctr = controlsRef.current;
      if (!cam || !ctr) return;
      cam.position.set(2.7, 2.1, 3.1);
      ctr.target.set(0, 0, 0);
      ctr.update();
    },
  }));

  // 初始化渲染器 / 相机 / 控制器
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(48, host.clientWidth / host.clientHeight, 0.01, 100);
    camera.position.set(2.7, 2.1, 3.1);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.2;
    controls.maxDistance = 14;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7aa2ff, 0.7);
    rim.position.set(-4, -2, -3);
    scene.add(rim);

    const nodeGroup = new THREE.Group();
    scene.add(nodeGroup);
    nodeGroupRef.current = nodeGroup;
    const labelGroup = new THREE.Group();
    scene.add(labelGroup);
    labelsRef.current = labelGroup;
    const axisGroup = new THREE.Group();
    scene.add(axisGroup);
    axesRef.current = axisGroup;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodesRef.current, false);
      const id = hits.length ? (hits[0].object.userData.id as string) : null;
      stateRef.current.onHover(id);
      setTip(id ? { x: e.clientX, y: e.clientY, id } : null);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodesRef.current, false);
      if (!hits.length) return;
      const id = hits[0].object.userData.id as string;
      stateRef.current.onPick(id);
      if (e.shiftKey || e.detail >= 2) stateRef.current.onOpen(id);
    };
    const onLeave = () => {
      stateRef.current.onHover(null);
      setTip(null);
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      rendererRef.current = null;
    };
  }, []);

  // 坐标轴 / 包围盒（依赖三个轴指标）
  useEffect(() => {
    const group = axesRef.current;
    if (!group) return;
    group.clear();
    group.add(buildAxes(props.xKey, props.yKey, props.zKey, props.models));
  }, [props.xKey, props.yKey, props.zKey, props.models]);

  // 节点与标签
  useEffect(() => {
    const labelGroup = labelsRef.current;
    const nodeGroup = nodeGroupRef.current;
    if (!labelGroup || !nodeGroup) return;

    // 清理旧的节点与标签
    for (const child of [...nodeGroup.children]) {
      nodeGroup.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
      (mesh.material as THREE.Material | undefined)?.dispose?.();
    }
    for (const child of [...labelGroup.children]) {
      labelGroup.remove(child);
      const sp = child as THREE.Sprite;
      sp.material?.map?.dispose();
      sp.material?.dispose();
    }
    nodesRef.current = [];

    const { models, xKey, yKey, zKey, sizeKey, colorKey, colorMode, selectedIds } = props;
    const nx = normalizeForDisplay(models, xKey);
    const ny = normalizeForDisplay(models, yKey);
    const nz = normalizeForDisplay(models, zKey);
    const ns = normalizeForDisplay(models, sizeKey);
    const nc = normalizeForDisplay(models, colorKey);

    const bigSet = models.length > 120;
    const geo = new THREE.SphereGeometry(1, bigSet ? 12 : 24, bigSet ? 8 : 18);
    for (const m of models) {
      const px = nx.get(m.id);
      const py = ny.get(m.id);
      const pz = nz.get(m.id);
      if (px == null || py == null || pz == null) continue;

      const cVal = nc.get(m.id) ?? 0.4;
      const color =
        colorMode === 'creator' ? new THREE.Color(m.creator.color) : rampColor(cVal);
      const selected = selectedIds.includes(m.id);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.34,
        metalness: 0.12,
        emissive: color.clone().multiplyScalar(selected ? 0.5 : 0.16),
        transparent: true,
        opacity: selected ? 1 : 0.88,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const r = 0.017 + Math.sqrt(Math.max(0, ns.get(m.id) ?? 0.3)) * 0.058;
      mesh.scale.setScalar(selected ? r * 1.28 : r);
      mesh.position.set(
        (px * 2 - 1) * SPAN,
        (py * 2 - 1) * SPAN * 0.86,
        (pz * 2 - 1) * SPAN,
      );
      mesh.userData = { id: m.id, baseScale: r, selected };
      nodeGroup.add(mesh);
      nodesRef.current.push(mesh);

      // 地面投影线（节点较多时仅保留选中项，控制绘制开销）
      if (!bigSet || selected) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z),
          new THREE.Vector3(mesh.position.x, -SPAN * 0.86, mesh.position.z),
        ]);
        const line = new THREE.Line(
          lineGeo,
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: selected ? 0.42 : 0.16 }),
        );
        nodeGroup.add(line);
      }

      if (props.showLabels || selected) {
        const label = makeLabel(m.shortName, selected ? '#ffffff' : '#aeb8cc', selected ? 40 : 34, selected);
        label.position.set(mesh.position.x, mesh.position.y + r + 0.045, mesh.position.z);
        labelGroup.add(label);
      }
    }
  }, [
    props.models,
    props.xKey,
    props.yKey,
    props.zKey,
    props.sizeKey,
    props.colorKey,
    props.colorMode,
    props.selectedIds,
    props.showLabels,
  ]);

  // 悬停高亮
  useEffect(() => {
    for (const mesh of nodesRef.current) {
      const ud = mesh.userData as { selected: boolean; baseScale: number };
      const isHover = mesh.userData.id === props.hoverId;
      mesh.scale.setScalar(ud.baseScale * (ud.selected ? 1.28 : 1) * (isHover ? 1.22 : 1));
    }
  }, [props.hoverId, props.models, props.selectedIds]);

  const tipModel = useMemo(
    () => (tip ? props.models.find((m) => m.id === tip.id) ?? null : null),
    [tip, props.models],
  );

  return (
    <div ref={hostRef} className="scene-host">
      {tip && tipModel ? (
        <Tooltip
          x={tip.x}
          y={tip.y}
          model={tipModel}
          rows={[
            { label: METRIC_MAP[props.xKey]?.label ?? props.xKey, value: formatMetricValue(props.xKey, getMetric(tipModel, props.xKey)) },
            { label: METRIC_MAP[props.yKey]?.label ?? props.yKey, value: formatMetricValue(props.yKey, getMetric(tipModel, props.yKey)) },
            { label: METRIC_MAP[props.zKey]?.label ?? props.zKey, value: formatMetricValue(props.zKey, getMetric(tipModel, props.zKey)) },
            { label: `大小 · ${METRIC_MAP[props.sizeKey]?.label ?? props.sizeKey}`, value: formatMetricValue(props.sizeKey, getMetric(tipModel, props.sizeKey)) },
            {
              label: `颜色 · ${props.colorMode === 'creator' ? '厂商' : METRIC_MAP[props.colorKey]?.label ?? props.colorKey}`,
              value:
                props.colorMode === 'creator'
                  ? tipModel.creator.name
                  : formatMetricValue(props.colorKey, getMetric(tipModel, props.colorKey)),
            },
          ]}
          hint="左键选中对比 · Shift+左键 / 双击查看详情"
        />
      ) : null}
    </div>
  );
});

/** 构建包围盒 + 三条带名称与极值的坐标轴 */
function buildAxes(xKey: string, yKey: string, zKey: string, models: Model[]): THREE.Group {
  const g = new THREE.Group();
  const sx = SPAN;
  const sy = SPAN * 0.86;
  const sz = SPAN;

  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(sx * 2, sy * 2, sz * 2)),
    new THREE.LineBasicMaterial({ color: 0x2a3a5c, transparent: true, opacity: 0.55 }),
  );
  g.add(box);

  const corner = new THREE.Vector3(-sx, -sy, -sz);
  const axisDefs: [THREE.Vector3, number, string, string][] = [
    [new THREE.Vector3(1, 0, 0), sx * 2, METRIC_MAP[xKey]?.label ?? xKey, xKey],
    [new THREE.Vector3(0, 1, 0), sy * 2, METRIC_MAP[yKey]?.label ?? yKey, yKey],
    [new THREE.Vector3(0, 0, 1), sz * 2, METRIC_MAP[zKey]?.label ?? zKey, zKey],
  ];
  const colors = [0x6aa6ff, 0x4ade80, 0xfbbf24];
  /** 三条轴的最小值标签都落在同一角点，用各自独立的偏移避免重叠 */
  const LO_OFFSETS = [new THREE.Vector3(-0.02, -0.16, 0.02), new THREE.Vector3(-0.3, -0.02, 0), new THREE.Vector3(0.02, -0.32, 0.02)];

  axisDefs.forEach(([dir, len, label, key], i) => {
    const end = corner.clone().addScaledVector(dir, len);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([corner.clone(), end]),
      new THREE.LineBasicMaterial({ color: colors[i], transparent: true, opacity: 0.85 }),
    );
    g.add(line);

    const values = models.map((m) => getMetric(m, key)).filter((v): v is number => v != null);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    const loSprite = makeLabel(formatMetricValue(key, min), '#8b96ad', 32);
    loSprite.position.copy(corner).add(LO_OFFSETS[i]);
    g.add(loSprite);
    const hiSprite = makeLabel(formatMetricValue(key, max), '#c7d0e0', 32);
    hiSprite.position.copy(end).addScaledVector(dir, 0.1);
    g.add(hiSprite);

    const nameSprite = makeLabel(label, `#${colors[i].toString(16).padStart(6, '0')}`, 36, true);
    nameSprite.position
      .copy(corner)
      .addScaledVector(dir, len * 0.5)
      .addScaledVector(new THREE.Vector3(0, 1, 0), i === 1 ? 0.2 : 0.14);
    g.add(nameSprite);
  });

  const grid = new THREE.GridHelper(sx * 2, 8, 0x24304a, 0x18202f);
  grid.position.y = -sy;
  (grid.material as THREE.Material).opacity = 0.5;
  (grid.material as THREE.Material).transparent = true;
  g.add(grid);

  return g;
}
