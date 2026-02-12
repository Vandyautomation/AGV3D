"use client";

import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
type CamMode = "ORBIT" | "FOLLOW" | "FPV";
type Vec3Tuple = [number, number, number];
type UploadedGlb = { id: string; name: string; url: string; position: Vec3Tuple; scale: number };
type Vec3 = { x: number; y: number; z: number };

/* ===== Keyboard ===== */
function useKeys() {
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const d = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const u = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    return () => {
      window.removeEventListener("keydown", d);
      window.removeEventListener("keyup", u);
    };
  }, []);
  return keys;
}

/* ===== Flame Effect ===== */
function Flame({ keys }: { keys: React.MutableRefObject<Record<string, boolean>> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const baseColor = useMemo(() => new THREE.Color("#ff6a00"), []);

  useFrame(({ clock }) => {
    const m = meshRef.current;
    const mat = matRef.current;
    const light = lightRef.current;
    if (!m || !mat || !light) return;

    const active = !!keys.current["Space"];
    m.visible = active;
    light.visible = active;
    if (!active) return;

    // Simple pulsing flame.
    const t = clock.getElapsedTime();
    const pulse = 0.85 + Math.sin(t * 40) * 0.15;
    m.scale.set(0.25 * pulse, 0.25 * pulse, 1.4 * pulse);
    mat.emissive.copy(baseColor);
    mat.emissiveIntensity = 1.5 + Math.sin(t * 60) * 0.5;
    light.intensity = 2.5 + Math.sin(t * 50) * 0.6;
  });

  return (
    <group position={[0.95, 0.45, 0]}>
      <mesh ref={meshRef} rotation={[0, 0, -Math.PI / 2]} visible={false}>
        <coneGeometry args={[0.28, 1.4, 16, 1, true]} />
        <meshStandardMaterial
          ref={matRef}
          color="#ffb347"
          emissive="#ff6a00"
          emissiveIntensity={1.8}
          transparent
          opacity={0.95}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <pointLight
        ref={lightRef}
        visible={false}
        color="#ff6a00"
        intensity={2.5}
        distance={6}
        decay={2}
        position={[0.6, 0, 0]}
      />
    </group>
  );
}

/* ===== Environment ===== */
function EnvironmentModel({
  url,
  groundY = -0.01,
  position = [0, 0, 0],
  scale = 1,
  rotation = [0, 0, 0],
}: {
  url: string;
  groundY?: number;
  position?: [number, number, number];
  scale?: number;
  rotation?: [number, number, number];
}) {
  const { scene } = useGLTF(url);
  const envModel = useMemo(() => scene.clone(true), [scene]);
  const bbox = useMemo(() => new THREE.Box3().setFromObject(envModel), [envModel]);
  const yOffset = useMemo(() => groundY - bbox.min.y, [bbox, groundY]);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group position={[0, yOffset, 0]}>
        <primitive object={envModel} />
      </group>
    </group>
  );
}

/* ===== Uploaded GLB ===== */
function UploadedGLB({
  id,
  url,
  position = [0, 0, 0],
  scale = 1,
  rotation = [0, 0, 0],
  onReady,
}: {
  id: string;
  url: string;
  position?: Vec3Tuple;
  scale?: number;
  rotation?: Vec3Tuple;
  onReady?: (id: string, obj: THREE.Group | null) => void;
}) {
  const { scene } = useGLTF(url);
  const model = useMemo(() => scene.clone(true), [scene]);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    onReady?.(id, groupRef.current);
  }, [id, onReady]);
  return (
    <group
      ref={groupRef}
      position={position}
      rotation={rotation}
      scale={scale}
      userData={{ uploadId: id }}
    >
      <primitive object={model} />
    </group>
  );
}

/* ===== Cursor Tracker ===== */
function CursorTracker({
  onMove,
  groundY = -0.01,
}: {
  onMove: (pos: Vec3Tuple) => void;
  groundY?: number;
}) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const mouse = useMemo(() => new THREE.Vector2(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY), [groundY]);
  const point = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(plane, point)) {
        onMove([point.x, groundY, point.z]);
      }
    };
    gl.domElement.addEventListener("pointermove", onPointerMove);
    return () => gl.domElement.removeEventListener("pointermove", onPointerMove);
  }, [camera, gl.domElement, mouse, onMove, plane, point, raycaster, groundY]);

  return null;
}

/* ===== Drag Move ===== */
function DragMove({
  agvRef,
  onPick,
  onMove,
  onDrop,
  groundY,
}: {
  agvRef: React.MutableRefObject<THREE.Group | null>;
  onPick: (id: string | null) => void;
  onMove: (pos: Vec3Tuple) => void;
  onDrop: () => void;
  groundY: number;
}) {
  const { camera, gl, scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const mouse = useMemo(() => new THREE.Vector2(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  const draggingRef = useRef(false);
  const dragYRef = useRef<number | null>(null);
  const dragPosRef = useRef<Vec3Tuple | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const arrowDownRef = useRef(false);
  const dragModeRef = useRef<"Y" | "XZ" | null>(null);
  const dragOffsetRef = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "ArrowDown") arrowDownRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowDown") arrowDownRef.current = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const rect = gl.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const h of hits) {
        let cur: THREE.Object3D | null = h.object;
        while (cur) {
          if (agvRef.current && cur === agvRef.current) break;
          const id = cur.userData?.uploadId as string | undefined;
          if (id) {
            e.preventDefault();
            e.stopPropagation();
            const wp = new THREE.Vector3();
            cur.getWorldPosition(wp);
            dragYRef.current = wp.y;
            dragPosRef.current = [wp.x, wp.y, wp.z];
            lastPointerRef.current = { x: e.clientX, y: e.clientY };
            dragModeRef.current = null;
            plane.set(new THREE.Vector3(0, 1, 0), -wp.y);
            if (raycaster.ray.intersectPlane(plane, point)) {
              dragOffsetRef.current = new THREE.Vector3(wp.x - point.x, 0, wp.z - point.z);
            } else {
              dragOffsetRef.current = new THREE.Vector3(0, 0, 0);
            }
            if (!arrowDownRef.current) {
              // snap disabled
            }
            onPick(id);
            draggingRef.current = true;
            return;
          }
          cur = cur.parent;
        }
      }
      onPick(null);
    };
    const onPointerUp = () => {
      if (draggingRef.current) onDrop();
      draggingRef.current = false;
      dragYRef.current = null;
      dragPosRef.current = null;
      lastPointerRef.current = null;
      dragModeRef.current = null;
      dragOffsetRef.current = null;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const currentPos = dragPosRef.current ?? [0, groundY, 0];
      const last = lastPointerRef.current ?? { x: e.clientX, y: e.clientY };
      if (!dragModeRef.current && !arrowDownRef.current) {
        const dx = Math.abs(e.clientX - last.x);
        const dy = Math.abs(e.clientY - last.y);
        dragModeRef.current = dy > dx * 1.3 ? "Y" : "XZ";
      }
      if (arrowDownRef.current || dragModeRef.current === "Y") {
        const dy = e.clientY - last.y;
        const nextY = currentPos[1] - dy * 0.02;
        const next: Vec3Tuple = [currentPos[0], nextY, currentPos[2]];
        dragPosRef.current = next;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        onMove(next);
        return;
      }
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      const rect = gl.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const planeY = dragYRef.current ?? currentPos[1] ?? groundY;
      plane.set(new THREE.Vector3(0, 1, 0), -planeY);
      if (raycaster.ray.intersectPlane(plane, point)) {
        const offset = dragOffsetRef.current ?? new THREE.Vector3(0, 0, 0);
        const next: Vec3Tuple = [point.x + offset.x, planeY, point.z + offset.z];
        dragPosRef.current = next;
        onMove(next);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    gl.domElement.addEventListener("pointerdown", onPointerDown);
    gl.domElement.addEventListener("pointerup", onPointerUp);
    gl.domElement.addEventListener("pointerleave", onPointerUp);
    gl.domElement.addEventListener("pointermove", onPointerMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      gl.domElement.removeEventListener("pointerdown", onPointerDown);
      gl.domElement.removeEventListener("pointerup", onPointerUp);
      gl.domElement.removeEventListener("pointerleave", onPointerUp);
      gl.domElement.removeEventListener("pointermove", onPointerMove);
    };
  }, [
    agvRef,
    camera,
    gl.domElement,
    mouse,
    onDrop,
    onMove,
    onPick,
    plane,
    point,
    raycaster,
    scene,
    groundY,
  ]);

  return null;
}

/* ===== AGV Dummy ===== */
function AGV({ agvRef, setCamMode, flyMode, initialPos }: any) {
  const keys = useKeys();
  const speed = useRef(0);
  const turn = useRef(0);
  const rise = useRef(0);
  const { scene } = useGLTF("/AGV_1.glb");
  const groundY = -0.01;
  const shootDirLocal = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const bullets = useRef<{ pos: THREE.Vector3; vel: THREE.Vector3; life: number }[]>([]);
  const bulletMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const [bulletCount, setBulletCount] = useState(0);
  const lastShotAt = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const lastSoundAt = useRef(0);

  // Clone once so we don't mutate the cached GLTF scene during animation.
  const agvModel = useMemo(() => scene.clone(true), [scene]);
  const bbox = useMemo(() => new THREE.Box3().setFromObject(agvModel), [agvModel]);
  const size = useMemo(() => bbox.getSize(new THREE.Vector3()), [bbox]);
  const center = useMemo(() => bbox.getCenter(new THREE.Vector3()), [bbox]);
  const yOffset = useMemo(() => {
    // Compute the model's lowest Y, then offset so it sits on the ground plane.
    return groundY - bbox.min.y;
  }, [bbox, groundY]);
  const fpvPos = useMemo(
    () => new THREE.Vector3(0, Math.max(0.6, size.y * 0.75), size.z * 0.25),
    [size.y, size.z]
  );
  const nozzleLocal = useMemo(() => {
    // Anchor the nozzle to the actual model bounds so it matches AGV_1.glb.
    const nozzleX = bbox.max.x + Math.max(0.15, size.x * 0.05);
    const nozzleY = groundY - bbox.min.y + size.y * 0.7;
    const nozzleZ = center.z;
    return new THREE.Vector3(nozzleX, nozzleY, nozzleZ);
  }, [bbox, size.x, size.y, center.z, groundY]);

  useEffect(() => {
    const agv = agvRef.current;
    if (!agv) return;
    // Store camera hints derived from the model bounds so camera modes feel "automatic".
    agv.userData.cam = {
      height: size.y,
      width: size.x,
      depth: size.z,
      centerY: center.y,
      groundY,
    };
  }, [agvRef, size.x, size.y, size.z, center.y, groundY]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // Lazily unlock audio on first user interaction.
      if (!audioCtxRef.current) {
        const ctx = new AudioContext();
        const master = ctx.createGain();
        master.gain.value = 0.6;
        master.connect(ctx.destination);
        audioCtxRef.current = ctx;
        masterGainRef.current = master;
      }
      if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
      if (e.code === "Digit1") setCamMode("ORBIT");
      if (e.code === "Digit2") setCamMode("FOLLOW");
      if (e.code === "Digit3") setCamMode("FPV");
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [setCamMode]);

  useFrame((_, dt) => {
    const agv = agvRef.current;
    if (!agv) return;

    const f = (keys.current["KeyW"] ? 1 : 0) - (keys.current["KeyS"] ? 1 : 0);
    const r = (keys.current["KeyD"] ? 1 : 0) - (keys.current["KeyA"] ? 1 : 0);
    const u = (keys.current["KeyR"] ? 1 : 0) - (keys.current["KeyF"] ? 1 : 0);
    const firing = !!keys.current["Space"];

    speed.current = THREE.MathUtils.lerp(speed.current, f * 3, 0.1);
    turn.current = THREE.MathUtils.lerp(turn.current, r * 2, 0.1);
    rise.current = THREE.MathUtils.lerp(rise.current, u * 2, 0.1);

    agv.rotation.y -= turn.current * dt;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(agv.quaternion);
    agv.position.addScaledVector(dir, speed.current * dt);
    if (flyMode) {
      agv.position.y += rise.current * dt;
      if (u !== 0) agv.position.y = Math.round(agv.position.y * 100) / 100;
    }
    // Cache the AGV forward direction so FOLLOW mode stays behind the vehicle.
    agv.userData.forward = dir.clone().normalize();

    // Spawn simple "flame bullets" while Space is held.
    const now = performance.now() / 1000;
    const shootCooldown = 0.08;
    if (firing && now - lastShotAt.current >= shootCooldown) {
      const nozzleWorld = nozzleLocal.clone().applyQuaternion(agv.quaternion).add(agv.position);
      const shootDirWorld = shootDirLocal.clone().applyQuaternion(agv.quaternion).normalize();
      bullets.current.push({
        pos: nozzleWorld,
        vel: shootDirWorld.multiplyScalar(12),
        life: 1.2,
      });
      lastShotAt.current = now;
      setBulletCount(bullets.current.length);
    }

    // Play a soft "backsound" beep while firing (no external assets needed).
    const soundCooldown = 0.12;
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (firing && ctx && master && now - lastSoundAt.current >= soundCooldown) {
      if (ctx.state === "suspended") void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 180;
      gain.gain.value = 0.001;
      osc.connect(gain);
      gain.connect(master);
      const t0 = ctx.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.start(t0);
      osc.stop(t0 + 0.13);
      lastSoundAt.current = now;
    }

    // Update bullets in world space and cull expired ones.
    for (let i = bullets.current.length - 1; i >= 0; i -= 1) {
      const b = bullets.current[i];
      b.pos.addScaledVector(b.vel, dt);
      // Keep bullets above the ground plane so they don't drop "under" the floor visually.
      b.pos.y = Math.max(b.pos.y, groundY + 0.25);
      b.life -= dt;
      if (b.life <= 0) {
        bullets.current.splice(i, 1);
        bulletMeshes.current.splice(i, 1);
        setBulletCount(bullets.current.length);
        continue;
      }
      const m = bulletMeshes.current[i];
      if (m) {
        m.position.copy(b.pos);
        const s = 0.12 + (1.2 - b.life) * 0.06;
        m.scale.setScalar(s);
      }
    }

    agv.children.forEach((c: any) => {
      if (c.name?.startsWith("wheel")) c.rotateX(speed.current * dt * 2);
    });
  });

  const bulletMaterial = (
    <meshStandardMaterial
      color="#ffb347"
      emissive="#ff6a00"
      emissiveIntensity={2}
      toneMapped={false}
      transparent
      opacity={0.95}
    />
  );

  return (
    <>
      <group
        ref={agvRef}
        position={[initialPos?.[0] ?? 0, initialPos?.[1] ?? 0, initialPos?.[2] ?? 0]}
      >
        <group position={[0, yOffset, 0]}>
          <primitive object={agvModel} />
          <group name="fpv" position={fpvPos} />
          <Flame keys={keys} />
        </group>
      </group>

      <group>
        {Array.from({ length: bulletCount }).map((_, i) => (
          <mesh
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            ref={(m) => {
              bulletMeshes.current[i] = m;
            }}
            visible={!!bullets.current[i]}
          >
            <sphereGeometry args={[0.14, 10, 10]} />
            {bulletMaterial}
          </mesh>
        ))}
      </group>
    </>
  );
}

/* ===== Camera Rig ===== */
function CameraRig({ agvRef, controlsRef, mode }: any) {
  const { camera } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const followOffset = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame((_, dt) => {
    const agv = agvRef.current;
    if (!agv) return;

    const cam = agv.userData.cam ?? {};
    const height = cam.height ?? 2;
    const depth = cam.depth ?? 3;
    const centerY = cam.centerY ?? 0.6;
    const groundY = cam.groundY ?? -0.01;

    // Keep OrbitControls focused on the AGV automatically.
    if (mode === "ORBIT" && controlsRef?.current) {
      look.copy(agv.position).add(new THREE.Vector3(0, centerY, 0));
      controlsRef.current.target.lerp(look, 1 - Math.pow(0.01, dt));
      controlsRef.current.update();
    }

    if (mode === "FOLLOW") {
      const followHeight = Math.max(1.2, height * 0.9);
      const followDistance = Math.max(3, depth * 1.6);
      // Prefer the live forward direction; fall back to model forward.
      const liveForward = agv.userData.forward as THREE.Vector3 | undefined;
      if (liveForward) {
        forward.copy(liveForward);
      } else {
        forward.set(0, 0, -1).applyQuaternion(agv.quaternion).normalize();
      }
      v
        .copy(agv.position)
        .addScaledVector(forward, -followDistance)
        .addScaledVector(up, followHeight);
      // Never allow the camera to go below the ground plane.
      v.y = Math.max(v.y, groundY + 0.2);
      camera.position.lerp(v, 1 - Math.pow(0.001, dt));
      camera.up.set(0, 1, 0);
      look.copy(agv.position).add(new THREE.Vector3(0, Math.max(0.4, centerY * 0.9), 0));
      camera.lookAt(look);
    }

    if (mode === "FPV") {
      const fpv = agv.getObjectByName("fpv");
      if (fpv) {
        fpv.getWorldPosition(v);
        // Keep FPV camera above the ground to avoid "looking from below".
        v.y = Math.max(v.y, groundY + 0.2);
        camera.position.lerp(v, 1 - Math.pow(0.0001, dt));
        camera.up.set(0, 1, 0);
        look
          .set(0, Math.max(0.3, centerY * 0.6), -Math.max(2, depth * 1.5))
          .applyQuaternion(agv.quaternion)
          .add(agv.position);
        camera.lookAt(look);
      }
    }
  });

  return null;
}

/* ===== Pickup Box ===== */
function PickupBox({
  agvRef,
  onPrompt,
  position,
  pickRadius = 1.3,
  zRange,
  showMesh = false,
  targetUuid,
}: {
  agvRef: React.MutableRefObject<THREE.Group | null>;
  onPrompt: (value: string) => void;
  position: Vec3Tuple;
  pickRadius?: number;
  zRange?: [number, number];
  showMesh?: boolean;
  targetUuid?: string;
}) {
  const boxRef = useRef<THREE.Mesh>(null);
  const [carried, setCarried] = useState(false);
  const canPickRef = useRef(false);
  const triggerCenter = useMemo(() => new THREE.Vector3(), []);
  const agvCenter = useMemo(() => new THREE.Vector3(), []);
  const holdOffset = useMemo(() => new THREE.Vector3(0, 0.6, 0.8), []);
  const carriedRef = useRef<THREE.Object3D | null>(null);
  const { scene } = useThree();
  const groundY = -0.01;

  const resolvePickTarget = (obj: THREE.Object3D) => {
    let cur: THREE.Object3D = obj;
    while (cur.parent && cur.parent !== scene) {
      if (cur.parent.name) {
        cur = cur.parent;
        break;
      }
      cur = cur.parent;
    }
    return cur;
  };

  const cloneWithMaterials = (obj: THREE.Object3D) => {
    const clone = obj.clone(true);
    clone.traverse((child) => {
      const anyChild = child as THREE.Object3D & {
        material?: THREE.Material | THREE.Material[];
      };
      if (!anyChild.material) return;
      anyChild.material = Array.isArray(anyChild.material)
        ? anyChild.material.map((m) => m.clone())
        : anyChild.material.clone();
    });
    return clone;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyQ") return;
      if (!boxRef.current || !agvRef.current) return;
      if (!carried && canPickRef.current) {
        const hoveredObj = targetUuid
          ? scene.getObjectByProperty("uuid", targetUuid) ?? undefined
          : undefined;
        const pickTarget = hoveredObj ? resolvePickTarget(hoveredObj) : boxRef.current;
        if (!pickTarget || pickTarget === agvRef.current) return;
        const clone = cloneWithMaterials(pickTarget);
        agvRef.current.add(clone);
        clone.position.copy(holdOffset);
        clone.rotation.set(0, 0, 0);
        carriedRef.current = clone;
        setCarried(true);
      } else if (carried) {
        if (carriedRef.current) {
          scene.attach(carriedRef.current);
          carriedRef.current.position.y = groundY + 0.3;
          carriedRef.current = null;
        } else {
          scene.attach(boxRef.current);
          boxRef.current.position.y = groundY + 0.3;
        }
        setCarried(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agvRef, carried, holdOffset, scene, targetUuid]);

  useFrame(() => {
    const agv = agvRef.current;
    const box = boxRef.current;
    if (!agv || !box) return;

    if (!carried) {
      const hoveredObj = targetUuid
        ? scene.getObjectByProperty("uuid", targetUuid) ?? undefined
        : undefined;
      if (hoveredObj) {
        hoveredObj.getWorldPosition(triggerCenter);
      } else {
        box.getWorldPosition(triggerCenter);
      }
      agvCenter.copy(agv.position);
      agvCenter.y = triggerCenter.y;
      const zOk = zRange
        ? agv.position.z >= Math.min(zRange[0], zRange[1]) &&
          agv.position.z <= Math.max(zRange[0], zRange[1])
        : true;
      const xOk = Math.abs(agv.position.x - triggerCenter.x) <= pickRadius;
      const canPick = zOk && xOk;
      canPickRef.current = canPick;
      onPrompt(canPick ? "Press Q to pick" : "");
    } else {
      canPickRef.current = false;
      onPrompt("Press Q to drop");
    }
  });

  return (
    <mesh
      ref={boxRef}
      position={[position[0], groundY + 0.3, position[2]]}
      castShadow
      receiveShadow
      visible={showMesh}
    >
      <boxGeometry args={[0.6, 0.6, 0.6]} />
      <meshStandardMaterial color="#9ca3af" />
    </mesh>
  );
}

/* ===== Z Guide ===== */
function ZGuide({
  agvRef,
  targetZ,
  threshold = 0.01,
}: {
  agvRef: React.MutableRefObject<THREE.Group | null>;
  targetZ: number;
  threshold?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const textPos = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const agv = agvRef.current;
    const group = groupRef.current;
    if (!agv || !group) return;
    const dz = Math.abs(agv.position.z - targetZ);
    group.visible = dz <= threshold;
    if (!group.visible) return;
    textPos.set(agv.position.x, agv.position.y + 1, targetZ);
    group.position.copy(textPos);
  });

  return (
    <group ref={groupRef} visible={false}>
      <Text fontSize={0.5} color="#111827" anchorX="center" anchorY="middle">
        {`Z = ${targetZ.toFixed(2)}`}
      </Text>
    </group>
  );
}

/* ===== Mesh Picker (Debug) ===== */
function MeshPicker({
  onHover,
  onSelect,
  agvRef,
}: {
  onHover: (value: { name: string; uuid: string; z: number; uploadId?: string }) => void;
  onSelect: (value: { name: string; uuid: string; z: number }) => void;
  agvRef: React.MutableRefObject<THREE.Group | null>;
}) {
  const { camera, scene, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const mouse = useMemo(() => new THREE.Vector2(), []);
  const lastUuid = useRef("");
  const worldPos = useMemo(() => new THREE.Vector3(), []);
  const hoveredRef = useRef<{ name: string; uuid: string; z: number }>({
    name: "",
    uuid: "",
    z: 0,
  });
  const box = useMemo(() => new THREE.Box3(), []);
  const findUploadId = (obj: THREE.Object3D | null) => {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      const id = cur.userData?.uploadId as string | undefined;
      if (id) return id;
      cur = cur.parent;
    }
    return undefined;
  };
  const findSelectable = (obj: THREE.Object3D | null) => {
    let cur: THREE.Object3D | null = obj;
    while (cur?.parent && cur.parent.type !== "Scene") {
      cur = cur.parent;
    }
    return cur ?? obj;
  };

  const isDescendantOf = (obj: THREE.Object3D, ancestor: THREE.Object3D | null) => {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur === ancestor) return true;
      cur = cur.parent;
    }
    return false;
  };

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      if (!hits.length) {
        if (lastUuid.current) {
          lastUuid.current = "";
          hoveredRef.current = { name: "", uuid: "", z: 0 };
          onHover({ ...hoveredRef.current, uploadId: undefined });
        }
        return;
      }
      let best: THREE.Object3D | null = null;
      let bestVolume = Number.POSITIVE_INFINITY;
      for (const h of hits) {
        const obj = h.object;
        if (agvRef.current && isDescendantOf(obj, agvRef.current)) continue;
        box.setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const volume = size.x * size.y * size.z || Number.POSITIVE_INFINITY;
        if (volume < bestVolume) {
          bestVolume = volume;
          best = obj;
        }
      }
      const hit = best ?? hits[0].object;
      let selectable = findSelectable(hit);
      if (selectable) {
        box.setFromObject(selectable);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 30) selectable = hit;
      }
      const target = selectable ?? hit;
      const name = target.name || "(no name)";
      if (target.uuid !== lastUuid.current) {
        lastUuid.current = target.uuid;
        target.getWorldPosition(worldPos);
        hoveredRef.current = { name, uuid: target.uuid, z: worldPos.z };
        onHover({ ...hoveredRef.current, uploadId: findUploadId(target) });
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!hoveredRef.current.uuid) return;
      onSelect(hoveredRef.current);
    };
    gl.domElement.addEventListener("pointermove", onPointerMove);
    gl.domElement.addEventListener("pointerdown", onPointerDown);
    return () => {
      gl.domElement.removeEventListener("pointermove", onPointerMove);
      gl.domElement.removeEventListener("pointerdown", onPointerDown);
    };
  }, [camera, gl.domElement, mouse, raycaster, scene.children, onHover, onSelect, worldPos, agvRef, box]);

  return null;
}

/* ===== Hover Highlight ===== */
function HoverHighlight({
  hoveredUuid,
  boxRef,
  lineRef,
}: {
  hoveredUuid: string | null;
  boxRef: React.MutableRefObject<THREE.Box3>;
  lineRef: React.MutableRefObject<THREE.LineSegments | null>;
}) {
  const { scene } = useThree();
  const geomRef = useRef(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)));
  useFrame(() => {
    if (!lineRef.current) return;
    if (!hoveredUuid) {
      lineRef.current.visible = false;
      return;
    }
    const obj = scene.getObjectByProperty("uuid", hoveredUuid);
    if (!obj) {
      lineRef.current.visible = false;
      return;
    }
    boxRef.current.setFromObject(obj);
    const size = boxRef.current.getSize(new THREE.Vector3());
    const center = boxRef.current.getCenter(new THREE.Vector3());
    lineRef.current.position.copy(center);
    lineRef.current.scale.set(size.x, size.y, size.z);
    lineRef.current.visible = true;
  });
  return (
    <lineSegments ref={lineRef} geometry={geomRef.current}>
      <lineBasicMaterial color="#f59e0b" />
    </lineSegments>
  );
}

/* ===== Telemetry ===== */
function AGVTelemetry({
  agvRef,
  onUpdate,
}: {
  agvRef: React.MutableRefObject<THREE.Group | null>;
  onUpdate: (p: Vec3Tuple) => void;
}) {
  const acc = useRef(0);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.1) return;
    acc.current = 0;
    const agv = agvRef.current;
    if (!agv) return;
    onUpdate([agv.position.x, agv.position.y, agv.position.z]);
  });
  return null;
}

/* ===== Page ===== */
export default function Page() {
  const agvRef = useRef<THREE.Group>(null);
  const controlsRef = useRef<any>(null);
  const [camMode, setCamMode] = useState<CamMode>("ORBIT");
  const [flyMode, setFlyMode] = useState(false);
  const initialAgvPos: Vec3Tuple = [8.01, 10.94, -28.61];
  const [agvPos, setAgvPos] = useState<Vec3Tuple>(initialAgvPos);
  const [prompt, setPrompt] = useState("");
  const [hoveredMesh, setHoveredMesh] = useState<{
    name: string;
    uuid: string;
    z: number;
    uploadId?: string;
  }>({ name: "", uuid: "", z: 0 });
  const [pickupZ, setPickupZ] = useState(15);
  const [pickupLocked, setPickupLocked] = useState(false);
  const [uploads, setUploads] = useState<UploadedGlb[]>([]);
  const [draggedUploadId, setDraggedUploadId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [selectedPos, setSelectedPos] = useState<Vec3Tuple | null>(null);
  const [carriedIds, setCarriedIds] = useState<string[]>([]);
  const [pickupNotice, setPickupNotice] = useState("");
  const [importMinimized, setImportMinimized] = useState(false);
  const [hudMinimized, setHudMinimized] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [selectedUploadIds, setSelectedUploadIds] = useState<string[]>([]);
  const [attachRules, setAttachRules] = useState<{ id: string; offset: Vec3Tuple }[]>([]);
  const [hoverUploadId, setHoverUploadId] = useState<string | null>(null);
  const [hiddenUuids, setHiddenUuids] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groups, setGroups] = useState<
    {
      id: string;
      name: string;
      hidden: boolean;
      items: { kind: "upload" | "uuid"; id: string }[];
    }[]
  >([]);
  const [mappingLog, setMappingLog] = useState<
    { agv: Vec3Tuple; glb: Vec3Tuple; offset: Vec3Tuple; name: string }[]
  >([]);
  const cursorPosRef = useRef<Vec3Tuple>([0, -0.01, 0]);
  const groundY = agvPos[1];
  const uploadHistoryRef = useRef<UploadedGlb[][]>([]);
  const pendingUndoRef = useRef<UploadedGlb[] | null>(null);
  const uploadObjectMapRef = useRef<Map<string, THREE.Group>>(new Map());
  const sceneRef = useRef<THREE.Scene | null>(null);
  const highlightRef = useRef<THREE.LineSegments | null>(null);
  const highlightBoxRef = useRef(new THREE.Box3());
  const pickupPositions: Vec3Tuple[] = [[7.21, 0, pickupZ]];
  const initialCameraPos: Vec3Tuple = [
    initialAgvPos[0] + 4,
    initialAgvPos[1] + 4,
    initialAgvPos[2] + 6,
  ];
  const environmentUrl = "/BuildingStatic.glb";
  const showGround = true;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyT") setFlyMode((prev) => !prev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem("agv_hidden_uuids");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as string[];
      if (parsed.length) {
        if (sceneRef.current) {
          parsed.forEach((uuid) => {
            const obj = sceneRef.current?.getObjectByProperty("uuid", uuid);
            if (obj) obj.visible = true;
          });
        }
        localStorage.removeItem("agv_hidden_uuids");
        setHiddenUuids([]);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("agv_hidden_uuids", JSON.stringify(hiddenUuids));
    if (!sceneRef.current) return;
    hiddenUuids.forEach((uuid) => {
      const obj = sceneRef.current?.getObjectByProperty("uuid", uuid);
      if (obj) obj.visible = false;
    });
  }, [hiddenUuids]);

  useEffect(() => {
    const onHide = (e: KeyboardEvent) => {
      if (e.code !== "Delete" && e.code !== "KeyX") return;
      if (!sceneRef.current) return;
      if (!hoveredMesh.uuid) return;
      const obj = sceneRef.current.getObjectByProperty("uuid", hoveredMesh.uuid);
      if (!obj) return;
      obj.visible = false;
      setHiddenUuids((prev) =>
        prev.includes(hoveredMesh.uuid) ? prev : [...prev, hoveredMesh.uuid]
      );
    };
    window.addEventListener("keydown", onHide);
    return () => window.removeEventListener("keydown", onHide);
  }, [hoveredMesh.uuid]);

  useEffect(() => {
    const pickRadius = 2;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyQ") return;
      setCarriedIds((prevCarried) => {
        const agv = agvRef.current;
        if (!agv) return prevCarried;
        const nextCarried = new Set(prevCarried);
        for (const rule of attachRules) {
          const obj = uploadObjectMapRef.current.get(rule.id) ?? null;
          if (!obj) continue;
          if (nextCarried.has(rule.id)) {
            const world = new THREE.Vector3();
            obj.getWorldPosition(world);
            const newPos: Vec3Tuple = [world.x, world.y, world.z];
            if (sceneRef.current) sceneRef.current.attach(obj);
            else agvRef.current?.parent?.attach(obj);
            setUploads((prev) =>
              prev.map((u) => (u.id === rule.id ? { ...u, position: newPos } : u))
            );
            nextCarried.delete(rule.id);
            continue;
          }
          const world = new THREE.Vector3();
          obj.getWorldPosition(world);
          const dx = world.x - agvPos[0];
          const dz = world.z - agvPos[2];
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > pickRadius) continue;
          agv.add(obj);
          obj.position.set(rule.offset[0], rule.offset[1], rule.offset[2]);
          setUploads((prev) =>
            prev.map((u) => (u.id === rule.id ? { ...u, position: rule.offset } : u))
          );
          nextCarried.add(rule.id);
        }
        return Array.from(nextCarried);
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agvPos, attachRules]);

  useEffect(() => {
    const pickRadius = 2;
    let near = false;
    for (const rule of attachRules) {
      if (carriedIds.includes(rule.id)) continue;
      const obj = uploadObjectMapRef.current.get(rule.id);
      const world = obj ? obj.getWorldPosition(new THREE.Vector3()) : null;
      const tx = world ? world.x : 0;
      const tz = world ? world.z : 0;
      const dx = tx - agvPos[0];
      const dz = tz - agvPos[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= pickRadius) {
        near = true;
        break;
      }
    }
    if (near) setPickupNotice("Apakah kamu mau mengambil benda ini? (Q)");
    else if (carriedIds.length) setPickupNotice("Press Q to drop");
    else setPickupNotice("");
  }, [agvPos, attachRules, carriedIds]);

  useEffect(() => {
    const onUndo = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.code !== "KeyZ") return;
      e.preventDefault();
      const last = uploadHistoryRef.current.pop();
      if (last) setUploads(last);
    };
    window.addEventListener("keydown", onUndo);
    return () => window.removeEventListener("keydown", onUndo);
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem("agv_uploads");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as UploadedGlb[];
      if (parsed.length) setUploads(parsed);
    } catch {
      // ignore parse errors
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("agv_uploads", JSON.stringify(uploads));
  }, [uploads]);

  useEffect(() => {
    localStorage.setItem("agv_mappings", JSON.stringify(mappingLog));
  }, [mappingLog]);

  useEffect(() => {
    const raw = localStorage.getItem("agv_groups");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as typeof groups;
      if (parsed.length) setGroups(parsed);
    } catch {
      // ignore parse errors
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("agv_groups", JSON.stringify(groups));
    if (!sceneRef.current) return;
    groups.forEach((g) => {
      g.items.forEach((item) => {
        const obj =
          item.kind === "upload"
            ? uploadObjectMapRef.current.get(item.id) ?? null
            : sceneRef.current?.getObjectByProperty("uuid", item.id) ?? null;
        if (obj) obj.visible = !g.hidden;
      });
    });
  }, [groups]);

  useEffect(() => {
    return () => {
      uploads.forEach((u) => {
        if (u.url.startsWith("blob:")) URL.revokeObjectURL(u.url);
      });
    };
  }, [uploads]);

  return (
    <div style={{ height: "100vh" }}>
      <div
        style={{
          position: "fixed",
          zIndex: 10,
          padding: 12,
          top: 12,
          left: 12,
          background: "rgba(255, 255, 255, 0.75)",
          borderRadius: 8,
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <b>HUD</b>
          <button
            type="button"
            onClick={() => setHudMinimized((v) => !v)}
            style={{ pointerEvents: "auto" }}
          >
            {hudMinimized ? "Expand" : "Minimize"}
          </button>
        </div>
        {!hudMinimized && (
          <>
            <div>WASD = move</div>
            <div>R/F = up/down (fly)</div>
            <div>T = toggle fly mode</div>
            <div>1 Orbit | 2 Follow | 3 FPV</div>
            <div>
              Fly: <b>{flyMode ? "ON" : "OFF"}</b>
            </div>
            <div>Pos: {agvPos.map((v) => v.toFixed(2)).join(", ")}</div>
            {selectedPos && (
              <div>
                Selected: {selectedPos.map((v) => v.toFixed(2)).join(", ")}
              </div>
            )}
            {selectedPos && (
              <div>
                Δ:{" "}
                {selectedPos
                  .map((v, i) => (v - agvPos[i]).toFixed(2))
                  .join(", ")}
              </div>
            )}
            <div>Pickup Z: {pickupZ.toFixed(2)}</div>
            <div>Pickup Lock: {pickupLocked ? "ON" : "OFF"}</div>
            {hoveredMesh.uuid && (
              <div>
                Hover: {hoveredMesh.name} ({hoveredMesh.uuid})
              </div>
            )}
            {hoveredMesh.uuid && (
              <button
                type="button"
                onClick={() => {
                  if (!sceneRef.current) return;
                  const obj = sceneRef.current.getObjectByProperty("uuid", hoveredMesh.uuid);
                  if (!obj) return;
                  obj.visible = false;
                  setHiddenUuids((prev) =>
                    prev.includes(hoveredMesh.uuid) ? prev : [...prev, hoveredMesh.uuid]
                  );
                }}
                style={{ pointerEvents: "auto", marginTop: 6 }}
              >
                Hide Now
              </button>
            )}
            {prompt && <div>{prompt}</div>}
            {pickupNotice && <div>{pickupNotice}</div>}
            <b>Mode: {camMode}</b>
          </>
        )}
      </div>

      <div
        style={{
          position: "fixed",
          zIndex: 11,
          padding: 12,
          bottom: 64,
          left: 12,
          background: "rgba(255, 255, 255, 0.9)",
          borderRadius: 8,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <label style={{ display: "block", fontWeight: 600 }}>Import GLB</label>
          <button type="button" onClick={() => setImportMinimized((v) => !v)}>
            {importMinimized ? "Expand" : "Minimize"}
          </button>
        </div>
        {!importMinimized && (
          <>
            <input
              type="file"
              accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
              onChange={async (e) => {
                const input = e.currentTarget as HTMLInputElement;
                const file = input.files?.[0];
                if (!file) return;
                input.value = "";
                setUploadStatus("Uploading...");
                const formData = new FormData();
                formData.append("file", file);
                const res = await fetch("/api/upload", { method: "POST", body: formData });
                if (!res.ok) {
                  setUploadStatus(`Upload failed: ${res.status}`);
                  return;
                }
                const { url, name } = (await res.json()) as { url: string; name: string };
                setUploadStatus("Upload success");
                let position = cursorPosRef.current;
                if (agvRef.current) {
                  position = [
                    agvRef.current.position.x,
                    agvRef.current.position.y,
                    agvRef.current.position.z,
                  ];
                }
                let scale = 1;
                setUploads((prev) => [
                  ...prev,
                  {
                    id: `${name}-${Date.now()}`,
                    name,
                    url,
                    position,
                    scale,
                  },
                ]);
              }}
            />
            {uploadStatus && <div style={{ marginTop: 6, fontSize: 12 }}>{uploadStatus}</div>}
            {uploads.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                {uploads.map((u) => (
                  <div
                    key={u.id}
                    style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}
                  >
                    <span>{u.name}</span>
                    <input
                      type="range"
                      min={0.1}
                      max={5}
                      step={0.1}
                      value={u.scale}
                      onChange={(e) => {
                        const next = Number(e.currentTarget.value);
                        setUploads((prev) =>
                          prev.map((p) => (p.id === u.id ? { ...p, scale: next } : p))
                        );
                      }}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        setUploads((prev) => prev.filter((p) => p.id !== u.id));
                        if (u.url.startsWith("blob:")) URL.revokeObjectURL(u.url);
                        await fetch("/api/delete", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ url: u.url }),
                        });
                        if (draggedUploadId === u.id) setDraggedUploadId(null);
                      }}
                    >
                      Hapus
                    </button>
                  </div>
                ))}
              </div>
            )}
            {hiddenUuids.length > 0 && (
              <button
                type="button"
                style={{ marginTop: 8 }}
                onClick={() => {
                  if (sceneRef.current) {
                    hiddenUuids.forEach((uuid) => {
                      const obj = sceneRef.current?.getObjectByProperty("uuid", uuid);
                      if (obj) obj.visible = true;
                    });
                  }
                  setHiddenUuids([]);
                }}
              >
                Restore Hidden Objects
              </button>
            )}
            {/* Add Mapping / JSON export temporarily disabled */}
          </>
        )}
      </div>

      <div
        style={{
          position: "fixed",
          zIndex: 12,
          top: 12,
          right: 12,
          background: "rgba(255, 255, 255, 0.9)",
          borderRadius: 8,
          padding: 8,
        }}
      >
        <button type="button" onClick={() => setSimulateOpen(true)}>
          Simulate
        </button>
      </div>

      {simulateOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20,
            background: "rgba(0, 0, 0, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "80vw",
              maxWidth: 900,
              background: "rgba(255, 255, 255, 0.96)",
              borderRadius: 12,
              padding: 20,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Simulate</h2>
              <button type="button" onClick={() => setSimulateOpen(false)}>
                Close
              </button>
            </div>
            <p style={{ marginTop: 8 }}>
              Pilih object GLB lalu klik Add Rule. Q akan attach/detach semua rule yang dibuat.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => {
                  if (!hoverUploadId) return;
                  if (selectedUploadIds.includes(hoverUploadId)) return;
                  setSelectedUploadIds((prev) => [...prev, hoverUploadId]);
                }}
              >
                Use Hovered
              </button>
              <button
                type="button"
                onClick={() => {
                  const rules = selectedUploadIds
                    .map((id) => {
                      const obj = uploadObjectMapRef.current.get(id);
                      if (!obj) return null;
                      const world = obj.getWorldPosition(new THREE.Vector3());
                      const offset: Vec3Tuple = [
                        world.x - agvPos[0],
                        world.y - agvPos[1],
                        world.z - agvPos[2],
                      ];
                      return { id, offset };
                    })
                    .filter(Boolean) as { id: string; offset: Vec3Tuple }[];
                  if (!rules.length) return;
                  setAttachRules((prev) => {
                    const map = new Map(prev.map((r) => [r.id, r]));
                    for (const r of rules) map.set(r.id, r);
                    return Array.from(map.values());
                  });
                }}
              >
                Add Rule
              </button>
              <button type="button" onClick={() => setSelectedUploadIds([])}>
                Clear Selection
              </button>
              <button type="button" onClick={() => setAttachRules([])}>
                Clear Rules
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <h3 style={{ margin: "8px 0" }}>Uploads</h3>
                {uploads.map((u) => (
                  <label key={u.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={selectedUploadIds.includes(u.id)}
                      onChange={(e) => {
                        setSelectedUploadIds((prev) =>
                          e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                        );
                      }}
                    />
                    <span>{u.name}</span>
                  </label>
                ))}
              </div>
              <div>
                <h3 style={{ margin: "8px 0" }}>Rules</h3>
                {attachRules.length === 0 && <div>Belum ada rule.</div>}
                {attachRules.map((r) => (
                  <div key={r.id}>
                    {r.id} | offset: {r.offset.map((v) => v.toFixed(2)).join(", ")}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 16, borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
              <h3 style={{ margin: "8px 0" }}>Group Manager</h3>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Group name"
                  value={groupName}
                  onChange={(e) => setGroupName(e.currentTarget.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    const name = groupName.trim();
                    if (!name) return;
                    setGroups((prev) => [
                      ...prev,
                      { id: `${name}-${Date.now()}`, name, hidden: false, items: [] },
                    ]);
                    setGroupName("");
                  }}
                >
                  Create Group
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedGroupId || !hoveredMesh.uuid) return;
                    setGroups((prev) =>
                      prev.map((g) => {
                        if (g.id !== selectedGroupId) return g;
                        if (g.items.some((i) => i.id === hoveredMesh.uuid)) return g;
                        return {
                          ...g,
                          items: [...g.items, { kind: "uuid", id: hoveredMesh.uuid }],
                        };
                      })
                    );
                  }}
                >
                  Add Hovered (Scene)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedGroupId || !hoverUploadId) return;
                    setGroups((prev) =>
                      prev.map((g) => {
                        if (g.id !== selectedGroupId) return g;
                        if (g.items.some((i) => i.id === hoverUploadId)) return g;
                        return {
                          ...g,
                          items: [...g.items, { kind: "upload", id: hoverUploadId }],
                        };
                      })
                    );
                  }}
                >
                  Add Hovered (Upload)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedGroupId || selectedUploadIds.length === 0) return;
                    setGroups((prev) =>
                      prev.map((g) => {
                        if (g.id !== selectedGroupId) return g;
                        const existing = new Set(g.items.map((i) => i.id));
                        const nextItems = [...g.items];
                        selectedUploadIds.forEach((id) => {
                          if (!existing.has(id)) nextItems.push({ kind: "upload", id });
                        });
                        return { ...g, items: nextItems };
                      })
                    );
                  }}
                >
                  Add Selected Uploads
                </button>
              </div>
              {groups.length === 0 && <div>Belum ada group.</div>}
              {groups.map((g) => (
                <div key={g.id} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b>{g.name}</b>
                    <button
                      type="button"
                      onClick={() => setSelectedGroupId(g.id)}
                      style={{ fontWeight: selectedGroupId === g.id ? 700 : 400 }}
                    >
                      {selectedGroupId === g.id ? "Selected" : "Select"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setGroups((prev) =>
                          prev.map((x) => (x.id === g.id ? { ...x, hidden: !x.hidden } : x))
                        )
                      }
                    >
                      {g.hidden ? "Show" : "Hide"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setGroups((prev) => prev.filter((x) => x.id !== g.id))}
                    >
                      Delete Group
                    </button>
                  </div>
                  <div style={{ fontSize: 12 }}>
                    Items: {g.items.length}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Canvas
        camera={{ position: initialCameraPos, fov: 55, near: 0.1, far: 2000 }}
        onCreated={({ gl, scene }) => {
          gl.setClearColor("#e5e7eb");
          sceneRef.current = scene;
        }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[6, 8, 5]} intensity={1.2} />

        {showGround && (
          <mesh rotation-x={-Math.PI / 2} position={[0, groundY, 0]}>
            <planeGeometry args={[50, 50]} />
            <meshStandardMaterial color="#e5e7eb" side={THREE.DoubleSide} />
          </mesh>
        )}

        <EnvironmentModel url={environmentUrl} groundY={-0.01} />
        {uploads.map((u) => (
          <UploadedGLB
            key={u.id}
            id={u.id}
            url={u.url}
            position={u.position}
            scale={u.scale}
            onReady={(id, obj) => {
              if (obj) uploadObjectMapRef.current.set(id, obj);
              else uploadObjectMapRef.current.delete(id);
            }}
          />
        ))}

        {attachRules.map((r) => {
          const obj = uploadObjectMapRef.current.get(r.id);
          if (!obj || carriedIds.includes(r.id)) return null;
          const world = obj.getWorldPosition(new THREE.Vector3());
          return (
            <mesh
              key={`ring-${r.id}`}
              rotation-x={-Math.PI / 2}
              position={[world.x, groundY + 0.02, world.z]}
            >
              <ringGeometry args={[1.7, 2, 48]} />
              <meshBasicMaterial color="#16a34a" transparent opacity={0.6} />
            </mesh>
          );
        })}

        <AGV
          agvRef={agvRef}
          setCamMode={setCamMode}
          flyMode={flyMode}
          initialPos={initialAgvPos}
        />
        <CameraRig agvRef={agvRef} controlsRef={controlsRef} mode={camMode} />
        <AGVTelemetry agvRef={agvRef} onUpdate={setAgvPos} />
        {pickupPositions.map((pos, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <PickupBox
            key={i}
            agvRef={agvRef}
            onPrompt={setPrompt}
            position={pos}
            pickRadius={2}
            zRange={[pickupZ - 2, pickupZ + 2]}
            showMesh={false}
            targetUuid={hoveredMesh.uuid || undefined}
          />
        ))}
        <ZGuide agvRef={agvRef} targetZ={pickupZ} threshold={0.01} />
        <MeshPicker
          agvRef={agvRef}
          onHover={(data) => {
            setHoveredMesh(data);
            setHoverUploadId(data.uploadId ?? null);
            if (!data.uuid || pickupLocked) return;
            setPickupZ(data.z);
          }}
          onSelect={(data) => {
            setPickupZ(data.z);
            setPickupLocked(true);
          }}
        />
        <HoverHighlight
          hoveredUuid={hoveredMesh.uuid || null}
          boxRef={highlightBoxRef}
          lineRef={highlightRef}
        />
        <CursorTracker
          onMove={(pos) => {
            cursorPosRef.current = pos;
          }}
        />
        <DragMove
          agvRef={agvRef}
          onPick={(id) => {
            setDraggedUploadId(id);
            setIsDragging(!!id);
            if (id) {
              pendingUndoRef.current = uploads.map((u) => ({
                ...u,
                position: [...u.position] as Vec3Tuple,
              }));
            }
            if (!id) {
              setSelectedPos(null);
              return;
            }
            const found = uploads.find((u) => u.id === id);
            if (found) setSelectedPos(found.position);
          }}
          onMove={(pos) => {
            if (!draggedUploadId) return;
            setUploads((prev) =>
              prev.map((u) => (u.id === draggedUploadId ? { ...u, position: pos } : u))
            );
            setSelectedPos(pos);
          }}
          onDrop={() => {
            if (pendingUndoRef.current) {
              uploadHistoryRef.current.push(pendingUndoRef.current);
              pendingUndoRef.current = null;
            }
            setDraggedUploadId(null);
            setIsDragging(false);
          }}
          groundY={groundY}
        />

        {camMode === "ORBIT" && <OrbitControls ref={controlsRef} enabled={!isDragging} />}
      </Canvas>
    </div>
  );
}
