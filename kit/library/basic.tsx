/**
 * Basic widgets from the library: Icon and Video. Video is privacy-friendly: a YouTube
 * or Vimeo player is a click-to-load facade (the poster the site chose, or a plain
 * panel), so nothing is requested from the video host until the visitor presses play.
 */
import { useState } from "react";
import { Icon } from "../icon.tsx";
import { safeMediaSrc } from "../sanitize.ts";
import type { IconProps, VideoProps } from "../types.ts";
import { linkAttributes, registerWidget, type WidgetContext } from "../widgets.tsx";
import { GLYPHS } from "./glyphs.ts";

function IconWidget({ element, common }: WidgetContext) {
  const props = element.props as IconProps;
  const link = linkAttributes(props.link);
  const shape = <Icon icon={props.icon} className="ae-icon-glyph" />;
  const view = props.view ?? "default";
  const className = `ae-icon-shape ae-icon-${view}${view !== "default" ? ` ae-icon-${props.shape ?? "circle"}` : ""}`;
  return (
    <div {...common} className={`${common.className} ae-icon-widget`}>
      {link ? (
        <a className={className} {...link} aria-label={props.icon?.name ?? "Link"}>
          {shape}
        </a>
      ) : (
        <span className={className}>{shape}</span>
      )}
    </div>
  );
}

/** The video id from a YouTube, Vimeo or Wistia address; for a generic embed, the address itself; else null. */
export function videoId(source: VideoProps["source"], url: string): string | null {
  if (source === "youtube") {
    const match = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{6,20})/.exec(url);
    return match?.[1] ?? null;
  }
  if (source === "vimeo") {
    const match = /vimeo\.com\/(?:video\/)?(\d{4,14})/.exec(url);
    return match?.[1] ?? null;
  }
  if (source === "wistia") {
    const match = /(?:wistia\.(?:com|net)|wi\.st)\/(?:medias|embed\/(?:iframe|medias|playlists))\/([A-Za-z0-9]{6,16})/.exec(url);
    return match?.[1] ?? null;
  }
  // A generic embed keeps its address; a valid https one stands in for the id so the facade can gate it.
  if (source === "embed") return /^https:\/\//i.test(url) && !url.startsWith("data:") ? url : null;
  return null;
}

/** The player address for an embed, with the privacy-friendly host and our options. */
export function embedUrl(props: VideoProps, id: string, autoplay: boolean): string {
  const params = new URLSearchParams();
  const muted = props.muted || (props.autoplay ?? false);
  if (props.source === "youtube") {
    params.set("rel", "0");
    if (autoplay) params.set("autoplay", "1");
    if (muted) params.set("mute", "1");
    if (props.loop) {
      params.set("loop", "1");
      params.set("playlist", id);
    }
    if (props.controls === false) params.set("controls", "0");
    if (props.start) params.set("start", String(props.start));
    return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
  }
  if (props.source === "wistia") {
    params.set("seo", "false");
    if (autoplay) params.set("autoPlay", "true");
    if (muted) params.set("muted", "true");
    if (props.controls === false) params.set("playbar", "false");
    return `https://fast.wistia.net/embed/iframe/${id}?${params.toString()}`;
  }
  // A generic embed loads its own address unchanged (its own query string is kept intact).
  if (props.source === "embed") return id;
  params.set("dnt", "1");
  if (autoplay) params.set("autoplay", "1");
  if (muted) params.set("muted", "1");
  if (props.loop) params.set("loop", "1");
  if (props.controls === false) params.set("controls", "0");
  return `https://player.vimeo.com/video/${id}?${params.toString()}${props.start ? `#t=${props.start}s` : ""}`;
}

/** The short note under the play button, by source. */
const FACADE_NOTE: Record<string, string> = { youtube: "Plays from YouTube", vimeo: "Plays from Vimeo", wistia: "Plays from Wistia", embed: "Loads when you press play" };

function VideoPlayer({ props, editMode }: { props: VideoProps; editMode: boolean }) {
  const id = videoId(props.source, props.url);
  const [playing, setPlaying] = useState(!editMode && !!props.autoplay);
  const poster = safeMediaSrc(props.poster);
  const title = props.title || "Video";
  if (props.source === "file") {
    const src = safeMediaSrc(props.url);
    if (!src || src.startsWith("data:")) return <div className="ae-video-empty">Add a video file</div>;
    const autoplay = !editMode && !!props.autoplay;
    return (
      <video
        className="ae-video-media"
        src={src}
        poster={poster}
        controls={props.controls !== false}
        autoPlay={autoplay}
        muted={props.muted || autoplay}
        loop={props.loop}
        playsInline
        preload="metadata"
        aria-label={title}
      />
    );
  }
  if (!id) return <div className="ae-video-empty">Add a YouTube, Vimeo, Wistia or embed address</div>;
  if (playing && !editMode) {
    return <iframe className="ae-video-media" src={embedUrl(props, id, true)} title={title} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />;
  }
  return (
    <button type="button" className="ae-video-facade" onClick={() => setPlaying(true)} aria-label={`Play: ${title}`} data-ae-interactive="">
      {poster ? <img src={poster} alt="" loading="lazy" decoding="async" /> : null}
      <span className="ae-video-play">
        <Icon icon={GLYPHS.play} />
      </span>
      <span className="ae-video-note">{FACADE_NOTE[props.source] ?? "Plays on click"}</span>
    </button>
  );
}

function Video({ element, common, editMode }: WidgetContext) {
  const props = element.props as VideoProps;
  return (
    <div {...common} className={`${common.className} ae-video`} style={{ aspectRatio: (props.aspect ?? "16/9").replace("/", " / ") }}>
      <VideoPlayer props={props} editMode={editMode} />
    </div>
  );
}

registerWidget("icon", IconWidget);
registerWidget("video", Video);
