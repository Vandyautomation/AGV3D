"use client";

import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
type CamMode = "ORBIT" | "FOLLOW" | "FPV";
type Vec3Tuple = [number, number, number];
type UploadedGlb = { id: string; name: string; url: string; position: Vec3Tuple; scale: number };

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
}: {
  id: string;
  url: string;
  position?: Vec3Tuple;
  scale?: number;
  rotation?: Vec3Tuple;
}) {
  const { scene } = useGLTF(url);
  const model = useMemo(() => scene.clone(true), [scene]);
  return (
    <group position={position} rotation={rotation} scale={scale} userData={{ uploadId: id }}>
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
}: {
  agvRef: React.MutableRefObject<THREE.Group | null>;
  onPick: (id: string | null) => void;
  onMove: (pos: Vec3Tuple) => void;
  onDrop: () => void;
}) {
  const { camera, gl, scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const mouse = useMemo(() => new THREE.Vector2(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  const draggingRef = useRef(false);
  const dragYRef = useRef<number | null>(null);

  useEffect(() => {
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
            const wp = new THREE.Vector3();
            cur.getWorldPosition(wp);
            dragYRef.current = wp.y;
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
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const planeY = dragYRef.current ?? 0;
      plane.set(new THREE.Vector3(0, 1, 0), -planeY);
      if (raycaster.ray.intersectPlane(plane, point)) {
        onMove([point.x, planeY, point.z]);
      }
    };
    gl.domElement.addEventListener("pointerdown", onPointerDown);
    gl.domElement.addEventListener("pointerup", onPointerUp);
    gl.domElement.addEventListener("pointerleave", onPointerUp);
    gl.domElement.addEventListener("pointermove", onPointerMove);
    return () => {
      gl.domElement.removeEventListener("pointerdown", onPointerDown);
      gl.domElement.removeEventListener("pointerup", onPointerUp);
      gl.domElement.removeEventListener("pointerleave", onPointerUp);
      gl.domElement.removeEventListener("pointermove", onPointerMove);
    };
  }, [agvRef, camera, gl.domElement, mouse, onDrop, onMove, onPick, plane, point, raycaster, scene]);

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
  onHover: (value: { name: string; uuid: string; z: number }) => void;
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
          onHover(hoveredRef.current);
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
      const name = hit.name || "(no name)";
      if (hit.uuid !== lastUuid.current) {
        lastUuid.current = hit.uuid;
        hit.getWorldPosition(worldPos);
        hoveredRef.current = { name, uuid: hit.uuid, z: worldPos.z };
        onHover(hoveredRef.current);
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
  const [hoveredMesh, setHoveredMesh] = useState({ name: "", uuid: "", z: 0 });
  const [pickupZ, setPickupZ] = useState(15);
  const [pickupLocked, setPickupLocked] = useState(false);
  const [uploads, setUploads] = useState<UploadedGlb[]>([]);
  const [draggedUploadId, setDraggedUploadId] = useState<string | null>(null);
  const cursorPosRef = useRef<Vec3Tuple>([0, -0.01, 0]);
  const pickupPositions: Vec3Tuple[] = [[7.21, 0, pickupZ]];
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
    return () => {
      uploads.forEach((u) => URL.revokeObjectURL(u.url));
    };
  }, [uploads]);

  useEffect(() => {
    const byName = uploads.reduce<Record<string, { position: Vec3Tuple; scale: number }>>(
      (acc, u) => {
        acc[u.name] = { position: u.position, scale: u.scale };
        return acc;
      },
      {}
    );
    localStorage.setItem("agv_upload_defaults", JSON.stringify(byName));
  }, [uploads]);

  return (
    <div style={{ height: "100vh" }}>
      <div
        style={{
          position: "absolute",
          zIndex: 10,
          padding: 12,
          top: 12,
          left: 12,
          background: "rgba(255, 255, 255, 0.75)",
          borderRadius: 8,
          pointerEvents: "none",
        }}
      >
        <div>WASD = move</div>
        <div>R/F = up/down (fly)</div>
        <div>T = toggle fly mode</div>
        <div>1 Orbit | 2 Follow | 3 FPV</div>
        <div>
          Fly: <b>{flyMode ? "ON" : "OFF"}</b>
        </div>
        <div>Pos: {agvPos.map((v) => v.toFixed(2)).join(", ")}</div>
        <div>Pickup Z: {pickupZ.toFixed(2)}</div>
        <div>Pickup Lock: {pickupLocked ? "ON" : "OFF"}</div>
        {hoveredMesh.uuid && (
          <div>
            Hover: {hoveredMesh.name} ({hoveredMesh.uuid})
          </div>
        )}
        {prompt && <div>{prompt}</div>}
        <b>Mode: {camMode}</b>
      </div>

      <div
        style={{
          position: "absolute",
          zIndex: 11,
          padding: 12,
          bottom: 64,
          left: 12,
          background: "rgba(255, 255, 255, 0.9)",
          borderRadius: 8,
        }}
      >
        <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
          Import GLB
        </label>
        <input
          type="file"
          accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            let position = cursorPosRef.current;
            if (agvRef.current) {
              position = [agvRef.current.position.x, agvRef.current.position.y, agvRef.current.position.z];
            }
            let scale = 1;
            const raw = localStorage.getItem("agv_upload_defaults");
            if (raw) {
              try {
                const parsed = JSON.parse(raw) as Record<
                  string,
                  { position: Vec3Tuple; scale: number }
                >;
                const saved = parsed[file.name];
                if (saved) {
                  position = saved.position;
                  scale = saved.scale;
                }
              } catch {
                // ignore parse errors
              }
            }
            setUploads((prev) => [
              ...prev,
              {
                id: `${file.name}-${Date.now()}`,
                name: file.name,
                url,
                position,
                scale,
              },
            ]);
            e.currentTarget.value = "";
          }}
        />
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
                  onClick={() => {
                    setUploads((prev) => prev.filter((p) => p.id !== u.id));
                    URL.revokeObjectURL(u.url);
                    if (draggedUploadId === u.id) setDraggedUploadId(null);
                  }}
                >
                  Hapus
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Canvas
        camera={{ position: [4, 4, 6], fov: 55, near: 0.1, far: 2000 }}
        onCreated={({ gl }) => {
          gl.setClearColor("#e5e7eb");
        }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[6, 8, 5]} intensity={1.2} />

        {showGround && (
          <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}>
            <planeGeometry args={[50, 50]} />
            <meshStandardMaterial color="#e5e7eb" side={THREE.DoubleSide} />
          </mesh>
        )}

        <EnvironmentModel url={environmentUrl} groundY={-0.01} />
        {uploads.map((u) => (
          <UploadedGLB key={u.id} id={u.id} url={u.url} position={u.position} scale={u.scale} />
        ))}

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
            if (!data.uuid || pickupLocked) return;
            setPickupZ(data.z);
          }}
          onSelect={(data) => {
            setPickupZ(data.z);
            setPickupLocked(true);
          }}
        />
        <CursorTracker
          onMove={(pos) => {
            cursorPosRef.current = pos;
          }}
        />
        <DragMove
          agvRef={agvRef}
          onPick={(id) => setDraggedUploadId(id)}
          onMove={(pos) => {
            if (!draggedUploadId) return;
            setUploads((prev) =>
              prev.map((u) => (u.id === draggedUploadId ? { ...u, position: pos } : u))
            );
          }}
          onDrop={() => {
            if (!draggedUploadId) return;
            setUploads((prev) =>
              prev.map((u) =>
                u.id === draggedUploadId ? { ...u, position: [u.position[0], -0.01, u.position[2]] } : u
              )
            );
            setDraggedUploadId(null);
          }}
        />

        {camMode === "ORBIT" && <OrbitControls ref={controlsRef} />}
      </Canvas>
    </div>
  );
}
