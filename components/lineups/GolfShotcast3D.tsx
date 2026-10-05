"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { decodeTerrainGlb, worldFileUv, type Point3, type TerrainPrimitive } from "@/lib/shotcast/productionGeometry";
import type { Shotcast3DView } from "@/lib/shotcast/shotcast3dView";
import { createShotPlayback, type ShotReplayRequest } from "@/lib/shotcast/shotReplay";
import { createPuttReplay } from "@/lib/shotcast/puttReplay";
import { createGreenTopography } from "@/lib/shotcast/greenTopography";
import { createGreenFlow, createGreenFlowClock } from "@/lib/shotcast/greenFlow";
import { createGreenFlowPresentation, smoothDisplayFade, FLOW_HEAD_PIXELS, FLOW_TRAIL_PIXELS } from "@/lib/shotcast/greenFlowPresentation";

const vector = (point: Point3) => new THREE.Vector3(...point);

type Props = {
  view: Shotcast3DView;
  active: boolean;
  viewMode: "course" | "green";
  selectedStrokeNumber: number | null;
  resetRequest: number;
  replayRequest: ShotReplayRequest;
  onSelectStroke(strokeNumber: number): void;
  onReady(): void;
  onFailure(reason: string): void;
};

export default function GolfShotcast3D({ view, active, viewMode, selectedStrokeNumber, onSelectStroke, resetRequest, replayRequest, onReady, onFailure }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const showTee = !view.shots.some(shot => shot.strokeNumber === 1 && shot.from.every((value, axis) => value === view.tee[axis]));
  const selectedRef = useRef(selectedStrokeNumber);
  const modeRef = useRef(viewMode);
  const activeRef = useRef(active);
  const replayRequestRef = useRef(replayRequest);
  const consumedRequest = useRef(0);
  const replayActionsRef = useRef<{ select(stroke: number | null): void; reset(): void; request(stroke: number): void } | null>(null);
  const requestRenderRef = useRef<(() => void) | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const markerMaterials = useRef<Map<number, THREE.MeshBasicMaterial>>(new Map());
  const onReadyRef = useRef(onReady);
  const onFailureRef = useRef(onFailure);
  useEffect(() => { onReadyRef.current = onReady; onFailureRef.current = onFailure; }, [onReady, onFailure]);
  useEffect(() => {
    selectedRef.current = selectedStrokeNumber;
    replayActionsRef.current?.select(selectedStrokeNumber);
    for (const [stroke, material] of markerMaterials.current) material.color.set(stroke === selectedStrokeNumber ? "#73e9ff" : "#ffffff");
    requestRenderRef.current?.();
  }, [selectedStrokeNumber]);
  useEffect(() => { activeRef.current = active; if (!active) replayActionsRef.current?.reset(); requestRenderRef.current?.(); }, [active]);
  useEffect(() => {
    replayRequestRef.current = replayRequest;
    if (replayRequest && replayRequest.id > consumedRequest.current && replayActionsRef.current && activeRef.current) {
      consumedRequest.current = replayRequest.id;
      replayActionsRef.current.request(replayRequest.strokeNumber);
    }
  }, [replayRequest, active]);
  useEffect(() => { replayActionsRef.current?.reset(); resetCameraRef.current?.(); }, [resetRequest]);
  useEffect(() => { modeRef.current = viewMode; resetCameraRef.current?.(); }, [viewMode]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const controller = new AbortController();
    let disposed = false, frame = 0, needsRender = true;
    let drawFrame: (() => void) | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let observer: ResizeObserver | null = null;
    let intersection: IntersectionObserver | null = null;
    let playback: ReturnType<typeof createShotPlayback> | null = null;
    const flowClock = createGreenFlowClock();
    let inViewport = true;
    const visibilityChanged = () => { playback?.tick(performance.now(), false); flowClock.tick(performance.now(), false); markDirty(); };
    const markDirty = () => { needsRender = true; drawFrame?.(); };
    requestRenderRef.current = markDirty;
    const contextLost = (event: Event) => { event.preventDefault(); if (!disposed) onFailureRef.current("webgl_context_lost"); };
    let stage = "terrain_asset";
    document.addEventListener("scroll", markDirty, true);
    document.addEventListener("visibilitychange", visibilityChanged);
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];
    const dispose = () => {
      disposed = true;
      controller.abort();
      cancelAnimationFrame(frame);
      observer?.disconnect();
      intersection?.disconnect();
      document.removeEventListener("scroll", markDirty, true);
      document.removeEventListener("visibilitychange", visibilityChanged);
      controls?.dispose();
      requestRenderRef.current = null;
      resetCameraRef.current = null;
      replayActionsRef.current = null;
      markerMaterials.current.clear();
      for (const item of geometries) item.dispose();
      for (const item of materials) item.dispose();
      for (const item of textures) item.dispose();
      renderer?.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };
    const getBuffer = async (url: string) => {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("ShotCast 3D asset unavailable");
      return response.arrayBuffer();
    };
    const loadTexture = async (url: string, color: boolean) => {
      const texture = await new THREE.TextureLoader().loadAsync(url);
      if (disposed) { texture.dispose(); throw new Error("ShotCast view closed"); }
      texture.flipY = false;
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = Math.min(4, renderer?.capabilities.getMaxAnisotropy() ?? 1);
      textures.push(texture);
      return texture;
    };

    const start = async () => {
      const terrain = decodeTerrainGlb(await getBuffer(view.assets.terrain));
      stage = "green_asset";
      const green = view.assets.green ? decodeTerrainGlb(await getBuffer(view.assets.green)) : [];
      if (disposed) return;
      const topography = green.length ? createGreenTopography(green) : null;
      const flow = topography ? createGreenFlow(topography) : null;
      const replayClock = createShotPlayback(view.flightPaths ?? [], view.puttPaths ?? [], topography);
      playback = replayClock;
      replayClock.select(selectedRef.current);
      stage = "webgl_initialization";
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor("#102329");
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute("aria-label", `${view.courseName} 3D ShotCast. Drag to orbit; pinch or scroll to zoom.`);
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      element.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 8000);
      camera.up.set(0, 0, 1);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.addEventListener("change", markDirty);
      controls.minDistance = 5;
      controls.maxDistance = 4000;
      controls.maxPolarAngle = Math.PI / 2 - 0.04;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x466158, 2));
      const light = new THREE.DirectionalLight(0xfff6e8, 1.3);
      light.position.set(-30, -25, 80);
      scene.add(light);

      stage = "imagery_assets";
      const [courseTexture, holeTexture, maskTexture] = await Promise.all([
        loadTexture(view.assets.courseImage, true),
        loadTexture(view.assets.holeImage, true),
        loadTexture(view.assets.mask, false),
      ]);
      if (disposed) return;
      stage = "scene_initialization";
      const terrainMaterial = new THREE.ShaderMaterial({
        uniforms: { course: { value: courseTexture }, hole: { value: holeTexture }, mask: { value: maskTexture } },
        vertexShader: "attribute vec2 courseUv; varying vec2 vHole; varying vec2 vCourse; void main(){vHole=uv;vCourse=courseUv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
        fragmentShader: `uniform sampler2D course; uniform sampler2D hole; uniform sampler2D mask; varying vec2 vHole; varying vec2 vCourse;
          void main(){ vec4 color=texture2D(course,vCourse); if(min(vHole.x,vHole.y)>0.0 && max(vHole.x,vHole.y)<1.0){
          float edge=min(min(vHole.x,1.0-vHole.x),min(vHole.y,1.0-vHole.y)); color=mix(color,texture2D(hole,vHole),min(edge*100.0,1.0)); }
          color.rgb*=max(1.0-texture2D(mask,vCourse).a,0.5); gl_FragColor=vec4(color.rgb,1.0);
          #include <colorspace_fragment>
          }`,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      materials.push(terrainMaterial);
      const greenMeshes: { mesh: THREE.Mesh; imagery: THREE.Material }[] = [];
      const reliefMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0,
        side: THREE.DoubleSide, depthTest: false, depthWrite: false });
      materials.push(reliefMaterial);
      const lowColor = new THREE.Color("#235830"), highColor = new THREE.Color("#b6d875");
      const addTerrain = (primitives: TerrainPrimitive[], detailed: boolean) => {
        for (const primitive of primitives) {
          const geometry = new THREE.BufferGeometry();
          geometries.push(geometry);
          geometry.setAttribute("position", new THREE.BufferAttribute(primitive.positions, 3));
          geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
          const uv = new Float32Array(primitive.positions.length / 3 * 2);
          const courseUv = new Float32Array(uv.length);
          for (let i = 0; i < primitive.positions.length / 3; i++) {
            const x = primitive.positions[i * 3], y = primitive.positions[i * 3 + 1];
            uv.set(worldFileUv(view.worldFiles.hole, x, y), i * 2);
            courseUv.set(worldFileUv(view.worldFiles.course, x, y), i * 2);
          }
          geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
          geometry.setAttribute("courseUv", new THREE.BufferAttribute(courseUv, 2));
          let material = terrainMaterial;
          if (detailed) {
            material = terrainMaterial.clone();
            material.depthTest = false;
            materials.push(material);
          }
          if (detailed && topography) {
            if (primitive.normals) geometry.setAttribute("normal", new THREE.BufferAttribute(primitive.normals, 3));
            else geometry.computeVertexNormals();
            const colors = new Float32Array(primitive.positions.length);
            for (let i = 0; i < primitive.positions.length; i += 3) {
              const color = lowColor.clone().lerp(highColor, topography.normalizeElevation(primitive.positions[i + 2]));
              colors.set([color.r, color.g, color.b], i);
            }
            geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
          }
          const mesh = new THREE.Mesh(geometry, material);
          if (detailed) greenMeshes.push({ mesh, imagery: material });
          mesh.renderOrder = detailed ? 1 : 0;
          scene.add(mesh);
        }
      };
      addTerrain(terrain, false);
      addTerrain(green, true);

      // Scene anchors are the immutable course-world points. Symbol lift is
      // local to each anchor, never a change to a geographic coordinate.
      const anchors = new Map<string, THREE.Object3D>();
      const anchor = (name: string, point: Point3) => {
        const object = new THREE.Group();
        object.position.copy(vector(point));
        anchors.set(name, object); scene.add(object);
        return object;
      };
      const markerGeometry = new THREE.SphereGeometry(0.35, 12, 8);
      geometries.push(markerGeometry);
      const tee = anchor("tee", view.tee);
      if (showTee) {
        const teeMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff" });
        materials.push(teeMaterial);
        const teeMesh = new THREE.Mesh(markerGeometry, teeMaterial);
        teeMesh.position.z = 0.017068; tee.add(teeMesh);
      }
      for (const shot of view.shots) {
        const start = anchor(`from-${shot.strokeNumber}`, shot.from);
        // The numbered marker is the start of this stroke, including future replay.
        anchors.set(`shot-${shot.strokeNumber}`, start);
        anchor(`to-${shot.strokeNumber}`, shot.endpoint);
        const material = new THREE.MeshBasicMaterial({ color: shot.strokeNumber === selectedRef.current ? "#73e9ff" : "#ffffff" });
        materials.push(material);
        markerMaterials.current.set(shot.strokeNumber, material);
        const marker = new THREE.Mesh(markerGeometry, material);
        marker.position.z = 0.017068;
        start.add(marker);
      }
      const cup = anchor("pin", view.pin);
      // Donor primitive presentation, entirely local to the exact pin anchor.
      const cupMaterial = new THREE.MeshBasicMaterial({ color: "#101b15", side: THREE.DoubleSide, depthTest: false });
      const poleMaterial = new THREE.MeshBasicMaterial({ color: "#f8fafc", depthTest: false });
      const flagMaterial = new THREE.MeshBasicMaterial({ color: "#facc15", side: THREE.DoubleSide, depthTest: false });
      const cupGeometry = new THREE.CircleGeometry(0.16, 24);
      const poleGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1.6, 8);
      const flagGeometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 1.6, 0.7, 0, 1.38, 0, 0, 1.16], 3));
      materials.push(cupMaterial, poleMaterial, flagMaterial); geometries.push(cupGeometry, poleGeometry, flagGeometry);
      const cupMesh = new THREE.Mesh(cupGeometry, cupMaterial); cupMesh.position.z = 0.02;
      const pole = new THREE.Mesh(poleGeometry, poleMaterial); pole.rotation.x = Math.PI / 2; pole.position.z = 0.8;
      const flag = new THREE.Mesh(flagGeometry, flagMaterial);
      for (const mesh of [cupMesh, pole, flag]) mesh.renderOrder = 4;
      cup.add(cupMesh, pole, flag);
      element.dataset.shotcastPinPresentation = JSON.stringify({ anchor: cup.position.toArray(), source: "donor-local-primitives" });

      const flowPresentation = createGreenFlowPresentation(flow?.count ?? 0);
      const puttCorridors = new Map((view.puttPaths ?? []).map(path =>
        [path.strokeNumber, [...path.samples.map(sample => sample.position), path.endpoint]]));
      const flowGeometry = new THREE.BufferGeometry();
      flowGeometry.setAttribute("position", new THREE.BufferAttribute(flow?.positions ?? new Float32Array(), 3).setUsage(THREE.DynamicDrawUsage));
      flowGeometry.setAttribute("weight", new THREE.BufferAttribute(flow?.weights ?? new Float32Array(), 1).setUsage(THREE.DynamicDrawUsage));
      flowGeometry.setAttribute("displayAlpha", new THREE.BufferAttribute(flowPresentation.displayAlpha, 1).setUsage(THREE.DynamicDrawUsage));
      const flowMaterial = new THREE.ShaderMaterial({
        uniforms: { pixelRatio: { value: renderer.getPixelRatio() }, headSize: { value: FLOW_HEAD_PIXELS }, trailSize: { value: FLOW_TRAIL_PIXELS } },
        transparent: true, depthTest: false, depthWrite: false,
        vertexShader: `uniform float pixelRatio; uniform float headSize; uniform float trailSize;
          attribute float weight; attribute float displayAlpha; varying float vAlpha;
          void main(){vAlpha=weight*displayAlpha;gl_PointSize=(vAlpha>0.0?(weight>0.5?headSize:trailSize):0.0)*pixelRatio;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `varying float vAlpha; void main(){float d=length(gl_PointCoord-vec2(0.5));if(d>0.5||vAlpha<=0.0)discard;
          float edge=1.0-smoothstep(0.30,0.5,d);gl_FragColor=vec4(vec3(0.18,0.64,0.76),vAlpha*edge);}`,
      });
      geometries.push(flowGeometry); materials.push(flowMaterial);
      const flowDots = new THREE.Points(flowGeometry, flowMaterial); flowDots.renderOrder = 2; flowDots.frustumCulled = false; scene.add(flowDots);
      if (topography) element.dataset.shotcastTopography = JSON.stringify({ bounds: topography.bounds, elevationRange: topography.elevationRange,
        vertices: topography.vertices, triangles: topography.triangles });

      // Replay owns its glyph and line buffers. The anchor map above is never a
      // playback target, and the scene's terrain/world transforms stay untouched.
      const flightLines = new Map<number, THREE.Line>();
      const puttLineTimes = new Map<number, readonly number[]>();
      for (const path of view.flightPaths ?? []) {
        const geometry = new THREE.BufferGeometry().setFromPoints(path.points.map(vector));
        const material = new THREE.LineBasicMaterial({ color: "#a9e8ff", transparent: true, opacity: 0.7, depthTest: false, depthWrite: false });
        geometries.push(geometry); materials.push(material);
        const line = new THREE.Line(geometry, material); line.renderOrder = 3;
        flightLines.set(path.strokeNumber, line); scene.add(line);
      }
      if (topography) for (const path of view.puttPaths ?? []) {
        const display = createPuttReplay(path, topography).displayPoints();
        const geometry = new THREE.BufferGeometry().setFromPoints(display.points.map(vector));
        const material = new THREE.LineBasicMaterial({ color: "#f5fbff", transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
        geometries.push(geometry); materials.push(material);
        const line = new THREE.Line(geometry, material); line.renderOrder = 3;
        flightLines.set(path.strokeNumber, line); puttLineTimes.set(path.strokeNumber, display.times); scene.add(line);
      }
      const ballGeometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
      const ballMaterial = new THREE.ShaderMaterial({
        uniforms: { pixelRatio: { value: renderer.getPixelRatio() }, glyphScale: { value: 1 } }, transparent: true, depthTest: false, depthWrite: false,
        vertexShader: "uniform float pixelRatio; uniform float glyphScale; void main(){gl_PointSize=11.0*pixelRatio*glyphScale;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
        fragmentShader: "uniform float glyphScale; void main(){float d=length(gl_PointCoord-vec2(0.5));if(d>0.5||glyphScale<=0.0)discard;gl_FragColor=vec4(mix(vec3(1.0),vec3(0.04,0.12,0.16),smoothstep(0.32,0.42,d)),1.0-smoothstep(0.45,0.5,d));}",
      });
      geometries.push(ballGeometry); materials.push(ballMaterial);
      const replayBall = new THREE.Points(ballGeometry, ballMaterial);
      replayBall.frustumCulled = false; replayBall.renderOrder = 5; scene.add(replayBall);
      const updateReplay = () => {
        const state = replayClock.snapshot();
        replayBall.visible = !!state.sample && activeRef.current;
        if (state.sample) replayBall.position.copy(vector(state.sample.position));
        const putt = view.puttPaths?.find(path => path.strokeNumber === state.selected);
        const atCup = putt && putt.endpoint.every((v, i) => v === view.pin[i]);
        // Shrink only the glyph at the cup; its logical/world anchor never sinks.
        ballMaterial.uniforms.glyphScale.value = atCup && state.elapsed >= putt.sourceDuration
          ? (putt.connectorSeconds ? Math.max(0, 1 - (state.elapsed - putt.sourceDuration) / putt.connectorSeconds) : 0) : 1;
        for (const [stroke, line] of flightLines) {
          line.visible = stroke === state.selected && activeRef.current;
          const times = puttLineTimes.get(stroke);
          const count = state.sample && times ? times.findIndex(t => t > state.elapsed) : -1;
          line.geometry.setDrawRange(0, state.sample ? (times ? (count < 0 ? times.length : Math.max(2, count)) : state.sample.segment + 2) : Infinity);
        }
      };
      // Selection may have changed while course assets were loading.
      replayClock.select(selectedRef.current);
      replayActionsRef.current = {
        select(stroke) { replayClock.select(stroke); updateReplay(); markDirty(); },
        reset() { replayClock.reset(); updateReplay(); markDirty(); },
        request(stroke) { if (activeRef.current && replayClock.request(stroke)) { updateReplay(); markDirty(); } },
      };
      const pending = replayRequestRef.current;
      if (pending && pending.id > consumedRequest.current && activeRef.current) {
        consumedRequest.current = pending.id; replayClock.request(pending.strokeNumber);
      }
      updateReplay();
      element.dataset.shotcastPuttPaths = JSON.stringify(view.puttPaths ?? []);
      element.dataset.shotcastFlightPaths = JSON.stringify(view.flightPaths ?? []);

      const resize = () => {
        if (!renderer || !controls || !element.clientWidth || !element.clientHeight) return;
        // Finish pending orbit inertia before a programmatic frame/reset. Otherwise
        // later renders (including selection) continue the previous camera motion.
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        renderer.setSize(element.clientWidth, element.clientHeight);
        camera.aspect = element.clientWidth / element.clientHeight;
        camera.updateProjectionMatrix();
        // The current panel initially selects the final stroke. Frame the whole
        // playable hole so that this does not open a misleading green close-up.
        // Selection highlights the recorded stroke start without moving the camera.
        const focusPoints = [view.tee, ...view.shots.map(shot => shot.endpoint), view.pin].filter((point): point is Point3 => point !== null);
        const bounds = new THREE.Box3();
        for (const point of focusPoints) bounds.expandByPoint(vector(point));
        if (focusPoints.length < 2) {
          for (const primitive of terrain) {
            const positions = primitive.positions;
            for (let i = 0; i < positions.length; i += 3) bounds.expandByPoint(new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]));
          }
        }
        if (modeRef.current === "green" && view.greenBounds) {
          bounds.min.copy(vector(view.greenBounds.min));
          bounds.max.copy(vector(view.greenBounds.max));
          bounds.expandByScalar(1);
        } else {
          bounds.expandByScalar(12);
        }
        if (bounds.isEmpty()) throw new Error("ShotCast terrain has no bounds");
        const center = bounds.getCenter(new THREE.Vector3());
        const longAxis = focusPoints.length > 1 ? vector(focusPoints[0]).sub(vector(focusPoints.at(-1)!)) : bounds.getSize(new THREE.Vector3());
        longAxis.z = 0;
        if (longAxis.lengthSq() < 0.01) longAxis.set(0, 1, 0);
        longAxis.normalize();
        const side = new THREE.Vector3(-longAxis.y, longAxis.x, 0);
        // Same orientation as the validated isolated hole overview, fitted to
        // the actual viewport aspect instead of a fixed desktop camera radius.
        const direction = longAxis.multiplyScalar(0.45).addScaledVector(side, 0.5).add(new THREE.Vector3(0, 0, 1.05)).normalize();
        const corners = [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => new THREE.Vector3(x ? bounds.max.x : bounds.min.x, y ? bounds.max.y : bounds.min.y, z ? bounds.max.z : bounds.min.z))));
        const right = new THREE.Vector3(0, 0, 1).cross(direction).normalize();
        const up = direction.clone().cross(right).normalize();
        const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), tanH = tanV * camera.aspect;
        let distance = 8;
        for (const corner of corners) {
          const relative = corner.clone().sub(center);
          distance = Math.max(distance, Math.abs(relative.dot(right)) / tanH + relative.dot(direction), Math.abs(relative.dot(up)) / tanV + relative.dot(direction));
        }
        distance *= 1.2;
        camera.position.copy(center).addScaledVector(direction, distance);
        controls.target.copy(center);
        controls.maxDistance = Math.max(4000, distance * 3);
        controls.update();
        controls.enableDamping = damping;
        markDirty();
      };
      observer = new ResizeObserver(resize);
      resetCameraRef.current = resize;
      observer.observe(element);
      intersection = new IntersectionObserver(entries => { inViewport = entries.some(entry => entry.isIntersecting); markDirty(); });
      intersection.observe(element);
      resize();
      let firstFrame = true;
      const labels = new Map<number, HTMLElement>();
      for (const item of element.querySelectorAll<HTMLElement>("[data-shot-marker]")) labels.set(Number(item.dataset.shotMarker), item);
      const pinLabel = element.querySelector<HTMLElement>("[data-shot-pin]");
      const teeLabel = element.querySelector<HTMLElement>("[data-shot-tee]");
      const project = (point: Point3) => {
        const projected = vector(point).project(camera);
        return { x: (projected.x + 1) * element.clientWidth / 2,
          y: (1 - projected.y) * element.clientHeight / 2,
          visible: [projected.x, projected.y, projected.z].every(Number.isFinite) &&
            projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 };
      };
      const positionLabel = (label: HTMLElement | null | undefined, point: Point3) => {
        if (!label) return;
        const projected = project(point);
        label.style.display = projected.visible ? "flex" : "none";
        // No collision resolution, selected-first ordering, viewport clamping,
        // or screen-space relocation. Overlapping points really are adjacent.
        label.style.left = `${projected.x}px`;
        label.style.top = `${projected.y}px`;
      };
      const draw = (time: number) => {
        if (disposed || !renderer || !controls) return;
        frame = 0;
        replayClock.tick(time, activeRef.current && !document.hidden);
        if (document.hidden) return;
        const replayState = replayClock.snapshot();
        controls.update();
        const showGreen = modeRef.current === "green";
        const flowActive = showGreen && activeRef.current && inViewport;
        flowDots.visible = flowActive;
        for (const item of greenMeshes) item.mesh.material = showGreen ? reliefMaterial : item.imagery;
        const flowDelta = flowClock.tick(time, flowActive);
        if (flow && flowActive) {
          flow.step(flowDelta);
          // Project opacity masks with the same camera matrix used for this draw.
          camera.updateMatrixWorld();
          const corridor = puttCorridors.get(selectedRef.current ?? -1) ?? null;
          const selectedShot = view.shots.find(shot => shot.strokeNumber === selectedRef.current);
          // Protect projected glyphs with opacity masks, never screen/world offsets.
          const focuses = [
            { point: view.pin, radius: 18 },
            ...(selectedShot ? [{ point: selectedShot.from, radius: 14 }, { point: selectedShot.endpoint, radius: 14 }] : []),
            ...(replayState.sample ? [{ point: replayState.sample.position, radius: 10 }] : []),
          ].map(focus => ({ ...project(focus.point), radius: focus.radius })).filter(focus => focus.visible);
          flowPresentation.update(flow.positions, corridor, (x, y, z) => {
            const p = project([x, y, z]);
            if (!p.visible) return 0;
            let alpha = 1;
            for (const focus of focuses) alpha = Math.min(alpha, smoothDisplayFade(Math.hypot(p.x - focus.x, p.y - focus.y), focus.radius, focus.radius + 6));
            return alpha;
          });
          flowGeometry.attributes.position.needsUpdate = true; flowGeometry.attributes.weight.needsUpdate = true;
          flowGeometry.attributes.displayAlpha.needsUpdate = true;
          element.dataset.shotcastFlow = JSON.stringify({ count: flow.count, retainedHeads: flowPresentation.retainedHeads,
            corridorStroke: corridor ? selectedRef.current : null, elapsed: flow.elapsed,
            positions: Array.from(flow.positions), weights: Array.from(flow.weights), displayAlpha: Array.from(flowPresentation.displayAlpha) });
          needsRender = true;
        }
        if (replayState.phase !== "idle") { updateReplay(); needsRender = true; }
        if (needsRender) {
          needsRender = false;
          renderer.render(scene, camera);
          for (const shot of view.shots) positionLabel(labels.get(shot.strokeNumber), shot.from);
          positionLabel(pinLabel, view.pin);
          positionLabel(teeLabel, view.tee);
          // Engineering evidence from actual scene anchors/matrices, not a copy
          // of the response: browser invariance tests read these after actions.
          element.dataset.shotcastWorld = JSON.stringify(Object.fromEntries([...anchors].map(([name, object]) => [name, object.getWorldPosition(new THREE.Vector3()).toArray()])));
          element.dataset.shotcastProjections = JSON.stringify(Object.fromEntries([...anchors].map(([name, object]) => [name, project(object.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number])])));
          element.dataset.shotcastCamera = JSON.stringify(camera.matrixWorld.elements);
          element.dataset.shotcastTerrain = JSON.stringify(scene.children.filter(object => object instanceof THREE.Mesh).map(object => object.matrixWorld.elements));
          element.dataset.shotcastMode = modeRef.current;
          element.dataset.shotcastFlight = JSON.stringify({ selected: replayState.selected, phase: replayState.phase, elapsed: replayState.elapsed, kind: replayState.kind, duration: replayState.duration,
            position: replayBall.visible ? replayBall.getWorldPosition(new THREE.Vector3()).toArray() : null });
          if (firstFrame) { firstFrame = false; onReadyRef.current(); }
        }
        if (replayState.phase === "playing" || (flowActive && flow?.count)) drawFrame?.();
      };
      drawFrame = () => { if (!disposed && !frame) frame = requestAnimationFrame(draw); };
      drawFrame();
    };
    void start().catch(error => {
      if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) onFailureRef.current(`${stage}: ${error instanceof Error ? error.message : "failed"}`);
    });
    return dispose;
  }, [view, showTee]);

  return <div ref={host} className="relative h-full w-full touch-none bg-slate-950"
    onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()}
    onPointerUp={event => event.stopPropagation()} onPointerCancel={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    <div className="pointer-events-none absolute inset-0 z-10">
      {view.shots.map(shot => <button
        key={shot.strokeNumber}
        type="button"
        data-shot-marker={shot.strokeNumber}
        aria-label={`Replay shot ${shot.strokeNumber} in 3D ShotCast`}
        aria-pressed={shot.strokeNumber === selectedStrokeNumber}
        style={{ zIndex: shot.strokeNumber === selectedStrokeNumber ? 2 : 1 }}
        onClick={() => onSelectStroke(shot.strokeNumber)}
        className={`pointer-events-auto absolute hidden h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[11px] font-black shadow-md ${shot.strokeNumber === selectedStrokeNumber ? "border-cyan-100 bg-cyan-300 text-slate-950" : "border-white bg-slate-950/85 text-white"}`}
      >{shot.strokeNumber}</button>)}
      {view.pin ? <div data-shot-pin aria-label="Hole pin" className="absolute hidden h-1 w-1 -translate-x-1/2 -translate-y-1/2 items-center justify-center opacity-0"></div> : null}
      {showTee ? <div data-shot-tee aria-label="Hole tee" className="absolute hidden h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-slate-950 text-xs font-black text-white shadow-md">T</div> : null}
    </div>
  </div>;
}
