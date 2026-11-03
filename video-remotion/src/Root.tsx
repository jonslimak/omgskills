import React from "react";
import { Composition } from "remotion";
import { ListicleVideo } from "./ListicleVideo";
import type { VideoData } from "./types";
import video1 from "./video1.json";
import video2 from "./video2.json";

const FPS = 30;

const videos: { compId: string; data: VideoData }[] = [
  { compId: "Video1Stripe", data: video1 as VideoData },
  { compId: "Video2Tokens", data: video2 as VideoData },
];

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {videos.map(({ compId, data }) => (
        <React.Fragment key={compId}>
          <Composition
            id={compId}
            component={ListicleVideo}
            durationInFrames={Math.ceil(data.audioDurationSec * FPS)}
            fps={FPS}
            width={1920}
            height={1080}
            defaultProps={{ data }}
          />
          <Composition
            id={`${compId}Portrait`}
            component={ListicleVideo}
            durationInFrames={Math.ceil(data.audioDurationSec * FPS)}
            fps={FPS}
            width={1080}
            height={1920}
            defaultProps={{ data }}
          />
        </React.Fragment>
      ))}
    </>
  );
};
