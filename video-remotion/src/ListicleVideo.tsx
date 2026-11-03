import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { SkillEntry, VideoData } from "./types";

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const TEXT = "#111111";
const MUTED = "#6b7280";
const SOFT = "#f7f7f8";
const LINE = "#e5e7eb";
const BLUE = "#007aff";
const GOLD = "#f7b500";

const smooth = { damping: 200 };


const usePortrait = () => {
  const { width, height } = useVideoConfig();
  return height > width;
};

const DotGrid: React.FC = () => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(13,13,13,0.10) 2px, transparent 2px)",
        backgroundSize: "48px 48px",
        maskImage: `radial-gradient(${width * 0.62}px ${height * 0.62}px at 50% 42%, black, transparent 78%)`,
        WebkitMaskImage: `radial-gradient(${width * 0.62}px ${height * 0.62}px at 50% 42%, black, transparent 78%)`,
      }}
    />
  );
};

const Eyes: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ fontSize: size, lineHeight: 1 }}>👀</div>
);

const FadeUp: React.FC<{
  delay: number;
  children: React.ReactNode;
  distance?: number;
}> = ({ delay, children, distance = 40 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, delay, config: smooth, durationInFrames: 30 });
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [distance, 0])}px)`,
      }}
    >
      {children}
    </div>
  );
};

// ---------- Intro ----------
const Intro: React.FC<{ data: VideoData; durationInFrames: number }> = ({ data, durationInFrames }) => {
  const frame = useCurrentFrame();
  const portrait = usePortrait();
  return (
    <AbsoluteFill style={{ background: "#ffffff", fontFamily: FONT }}>
      <DotGrid />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: portrait ? "0 70px" : 0,
        }}
      >
        <FadeUp delay={5}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 34 }}>
            <Eyes size={portrait ? 76 : 64} />
          </div>
        </FadeUp>
        <FadeUp delay={14}>
          <div
            style={{
              fontSize: portrait ? 86 : 92,
              fontWeight: 800,
              letterSpacing: "-0.04em",
              color: TEXT,
              textAlign: "center",
              lineHeight: 1.02,
              maxWidth: portrait ? 940 : 1300,
            }}
          >
            {data.displayTitle || data.title}
          </div>
        </FadeUp>
        {data.authorLogo && (
          <FadeUp delay={22}>
            <div
              style={{
                marginTop: portrait ? 52 : 46,
                display: "flex",
                alignItems: "center",
                gap: 22,
              }}
            >
              <Img
                src={staticFile(data.authorLogo)}
                style={{
                  width: portrait ? 116 : 104,
                  height: portrait ? 116 : 104,
                  borderRadius: 26,
                  border: `1.5px solid ${LINE}`,
                }}
              />
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: portrait ? 38 : 36, fontWeight: 700, color: TEXT }}>
                  @{data.authorHandle}
                </div>
                <div style={{ fontSize: portrait ? 28 : 26, color: MUTED, fontWeight: 500 }}>
                  official skills
                </div>
              </div>
            </div>
          </FadeUp>
        )}
        {!data.authorLogo && (
          <FadeUp delay={30}>
            <div
              style={{
                marginTop: portrait ? 48 : 42,
                fontSize: portrait ? 44 : 42,
                color: MUTED,
                fontWeight: 500,
              }}
            >
              {data.subtitle}
            </div>
          </FadeUp>
        )}
        <FadeUp delay={40}>
          <div
            style={{
              marginTop: portrait ? 76 : 60,
              display: "flex",
              flexDirection: portrait ? "column" : "row",
              gap: portrait ? 8 : 16,
              alignItems: "center",
              border: `1.5px solid ${LINE}`,
              borderRadius: portrait ? 28 : 999,
              padding: portrait ? "26px 44px" : "18px 36px",
              fontSize: portrait ? 34 : 30,
              color: MUTED,
              background: "#ffffff",
              textAlign: "center",
            }}
          >
            <span>
              Works with <b style={{ color: TEXT }}>Claude</b> ·{" "}
              <b style={{ color: TEXT }}>Codex</b> · <b style={{ color: TEXT }}>Cursor</b>
            </span>
            <span>— or any agent</span>
          </div>
        </FadeUp>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------- Skill segment ----------
const SkillCard: React.FC<{
  data: VideoData;
  skill: SkillEntry;
  number: number;
  durationInFrames: number;
}> = ({ data, skill, number, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const portrait = usePortrait();
  const padX = portrait ? 80 : 150;
  const padTop = portrait ? 150 : 110;
  const pointDelay = (i: number) => 34 + i * 14;
  const textAvail = width - padX * 2;
  const nameSize = Math.min(portrait ? 92 : 88, textAvail / (0.54 * skill.name.length));
  return (
    <AbsoluteFill style={{ background: "#ffffff", fontFamily: FONT }}>
      <DotGrid />
      <div
        style={{
          position: "absolute",
          right: portrait ? 60 : 70,
          bottom: portrait ? 54 : 44,
          display: "flex",
          alignItems: "center",
          gap: 12,
          opacity: 0.55,
        }}
      >
        <span style={{ fontSize: portrait ? 26 : 24, lineHeight: 1 }}>👀</span>
        <span style={{ fontSize: portrait ? 25 : 23, color: MUTED, fontWeight: 600 }}>
          omgskills.com
        </span>
      </div>
      <AbsoluteFill
        style={{ padding: `${padTop}px ${padX}px` }}
      >
        {/* header row */}
        <FadeUp delay={0} distance={26}>
          <div style={{ display: "flex", alignItems: "center", gap: portrait ? 22 : 28 }}>
            {(skill.logo || data.authorLogo) && (
              <Img
                src={staticFile(skill.logo || data.authorLogo!)}
                style={{
                  width: portrait ? 92 : 84,
                  height: portrait ? 92 : 84,
                  borderRadius: 26,
                  border: `1.5px solid ${LINE}`,
                }}
              />
            )}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: portrait ? 32 : 30,
                fontWeight: 800,
                color: TEXT,
              }}
            >
              {number}
            </div>
            <div style={{ fontSize: portrait ? 32 : 30, color: MUTED, fontWeight: 600 }}>
              by @{skill.author}
            </div>
            {!portrait && (
              <>
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 30, color: MUTED }}>
                  <span style={{ color: GOLD }}>★</span> {skill.stars}
                  {skill.installs ? `  ·  ${skill.installs} installs` : ""}
                </div>
              </>
            )}
          </div>
        </FadeUp>

        {portrait ? (
          <>
            <FadeUp delay={10}>
              <div
                style={{
                  marginTop: 100,
                  fontSize: nameSize,
                  fontWeight: 800,
                  letterSpacing: "-0.045em",
                  color: TEXT,
                  lineHeight: 0.98,
                }}
              >
                {skill.name}
              </div>
            </FadeUp>
            <FadeUp delay={22}>
              <div
                style={{
                  marginTop: 34,
                  fontSize: 48,
                  color: BLUE,
                  fontWeight: 600,
                  lineHeight: 1.15,
                }}
              >
                {skill.tagline}
              </div>
            </FadeUp>
            <FadeUp delay={28}>
              <div style={{ marginTop: 28, fontSize: 32, color: MUTED }}>
                <span style={{ color: GOLD }}>★</span> {skill.stars}
                {skill.installs ? `  ·  ${skill.installs} installs` : ""}
              </div>
            </FadeUp>
            <div style={{ marginTop: 84, display: "flex", flexDirection: "column", gap: 32 }}>
              {skill.points.map((pt, i) => (
                <FadeUp key={pt} delay={pointDelay(i)} distance={26}>
                  <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 7,
                        background: TEXT,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ fontSize: 42, color: "#3f3f46" }}>{pt}</div>
                  </div>
                </FadeUp>
              ))}
            </div>

          </>
        ) : (
          <div style={{ display: "flex", gap: 80, marginTop: 78, alignItems: "flex-start" }}>
            {/* left: text column */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <FadeUp delay={10}>
                <div
                  style={{
                    fontSize: nameSize,
                    fontWeight: 800,
                    letterSpacing: "-0.045em",
                    color: TEXT,
                    lineHeight: 0.98,
                  }}
                >
                  {skill.name}
                </div>
              </FadeUp>
              <FadeUp delay={22}>
                <div
                  style={{
                    marginTop: 34,
                    fontSize: 44,
                    color: BLUE,
                    fontWeight: 600,
                    lineHeight: 1.15,
                  }}
                >
                  {skill.tagline}
                </div>
              </FadeUp>
              <div style={{ marginTop: 64, display: "flex", flexDirection: "column", gap: 26 }}>
                {skill.points.map((pt, i) => (
                  <FadeUp key={pt} delay={pointDelay(i)} distance={26}>
                    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 7,
                          background: TEXT,
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ fontSize: 38, color: "#3f3f46" }}>{pt}</div>
                    </div>
                  </FadeUp>
                ))}
              </div>
            </div>

          </div>
        )}

      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------- Wrap ----------
const Wrap: React.FC<{ data: VideoData }> = ({ data }) => {
  const { width } = useVideoConfig();
  const portrait = usePortrait();
  const listWidth = portrait ? width - 140 : 900;
  return (
    <AbsoluteFill style={{ background: "#ffffff", fontFamily: FONT }}>
      <DotGrid />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: portrait ? "0 70px" : 0 }}>
        <FadeUp delay={4}>
          <div
            style={{
              fontSize: portrait ? 60 : 58,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: TEXT,
              marginBottom: portrait ? 80 : 64,
              textAlign: "center",
              lineHeight: 1.08,
            }}
          >
            {data.wrapTitle}{portrait ? <br /> : " — "}free &amp; open source
          </div>
        </FadeUp>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: portrait ? 26 : 22,
            marginBottom: portrait ? 110 : 80,
          }}
        >
          {data.skills.map((s, i) => (
            <FadeUp key={s.name} delay={16 + i * 9} distance={22}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 26,
                  border: `1.5px solid ${LINE}`,
                  borderRadius: 16,
                  padding: portrait ? "26px 32px" : "20px 34px",
                  width: listWidth,
                  background: "#ffffff",
                }}
              >
                <span
                  style={{
                    fontSize: 28,
                    color: MUTED,
                    fontWeight: 700,
                    width: 34,
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    fontSize: portrait ? 30 : 34,
                    fontWeight: 700,
                    color: TEXT,
                    fontFamily: "Menlo, monospace",
                  }}
                >
                  {s.name}
                </span>
                <span style={{ flex: 1 }} />
                {!portrait && (
                  <span style={{ fontSize: 26, color: MUTED }}>
                    <span style={{ color: GOLD }}>★</span> {s.stars}
                  </span>
                )}
              </div>
            </FadeUp>
          ))}
        </div>
        <FadeUp delay={70}>
          <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
            <Eyes size={portrait ? 62 : 56} />
            <div
              style={{
                fontSize: portrait ? 58 : 52,
                fontWeight: 800,
                color: TEXT,
                letterSpacing: "-0.02em",
              }}
            >
              omgskills.com
            </div>
          </div>
        </FadeUp>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------- Progress bar ----------
const Progress: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        height: 10,
        width: `${(frame / durationInFrames) * 100}%`,
        background: BLUE,
      }}
    />
  );
};

// ---------- Main ----------
export const ListicleVideo: React.FC<{ data: VideoData }> = ({ data }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const segs = data.segments;
  const startFrame = (i: number) => Math.round(segs[i].startSec * fps);
  const segDuration = (i: number) =>
    (i + 1 < segs.length ? startFrame(i + 1) : durationInFrames) - startFrame(i);

  return (
    <AbsoluteFill style={{ background: "#ffffff" }}>
      <Audio src={staticFile(data.audio)} />
      {segs.map((seg, i) => (
        <Sequence key={i} from={startFrame(i)} durationInFrames={segDuration(i)}>
          {seg.type === "intro" ? (
            <Intro data={data} durationInFrames={segDuration(i)} />
          ) : seg.type === "wrap" ? (
            <Wrap data={data} />
          ) : (
            <SkillCard
              data={data}
              skill={data.skills[seg.index as number]}
              number={(seg.index as number) + 1}
              durationInFrames={segDuration(i)}
            />
          )}
        </Sequence>
      ))}
      <Progress />
    </AbsoluteFill>
  );
};
