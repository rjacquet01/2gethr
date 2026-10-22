// High-accuracy GPS often times out on laptops/desktops and indoors. Try it
// first, then fall back to a coarser (Wi-Fi/cell/IP) fix so sharing still works.
// Callers that don't need GPS (a still phone's heartbeat) can ask for a
// low-accuracy fix and accept a recently cached one via `maximumAge`.
export function getPositionWithFallback(
  onSuccess: PositionCallback,
  onError: PositionErrorCallback,
  opts: { highAccuracy?: boolean; maximumAge?: number } = {}
) {
  const { highAccuracy = true, maximumAge = 0 } = opts
  navigator.geolocation.getCurrentPosition(
    onSuccess,
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        onError(err)
        return
      }
      navigator.geolocation.getCurrentPosition(onSuccess, onError, {
        enableHighAccuracy: false,
        timeout: 30000,
        maximumAge: Math.max(maximumAge, 5 * 60 * 1000),
      })
    },
    { enableHighAccuracy: highAccuracy, timeout: highAccuracy ? 12000 : 20000, maximumAge }
  )
}
