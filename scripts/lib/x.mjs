/**
 * Pulls the image or video out of an X post without scraping. X's syndication
 * endpoint (the one embedded tweets use) returns the post as JSON, media
 * variants included.
 */

export function tweetId(url) {
  const m = String(url).match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

// The endpoint wants a token derived from the id. The derivation is public
// (it's in X's embed script); "a" also works today but may not tomorrow.
function tokenFor(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export async function fetchTweet(id) {
  for (const token of [tokenFor(id), "a"]) {
    const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (res.ok) {
      const data = await res.json();
      if (data && data.__typename !== "TweetTombstone") return data;
    }
  }
  throw new Error("X returned nothing for this post (deleted, protected, or the endpoint changed)");
}

/**
 * Best media for the feed: the highest-bitrate mp4 if the post has a video or
 * GIF, otherwise the first photo at full size.
 */
export function pickMedia(tweet) {
  const details = tweet.mediaDetails || [];
  for (const m of details) {
    if (m.type === "video" || m.type === "animated_gif") {
      const variants = (m.video_info?.variants || [])
        .filter((v) => v.content_type === "video/mp4")
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      if (variants[0]) {
        return { video: variants[0].url, poster: m.media_url_https || null };
      }
    }
  }
  const photo = details.find((m) => m.type === "photo") || tweet.photos?.[0];
  if (photo) {
    const url = photo.media_url_https || photo.url;
    return { video: null, poster: url.includes("?") ? url : `${url}?name=large` };
  }
  return null;
}
