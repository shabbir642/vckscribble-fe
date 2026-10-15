/**
 * Getting a player's attention when the game needs them and their tab is in
 * the background — their turn to draw would otherwise time out unseen. The tab
 * title blinks until they look; the sound already plays.
 */
let timer: ReturnType<typeof setInterval> | null = null;
let original = '';

function stop(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  document.title = original;
}

export function callAttention(message: string): void {
  if (!document.hidden || timer) return;
  original = document.title;
  let on = false;
  timer = setInterval(() => {
    on = !on;
    document.title = on ? message : original;
  }, 1000);
  document.title = message;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) stop();
});
