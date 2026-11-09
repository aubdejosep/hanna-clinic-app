// Shrinks a photo in the browser before upload, so it's small to store and quick to load.
export function resizeImage(file, maxSide = 320, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('Choose a photo (JPG, PNG or WebP).')); return }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file couldn't be opened as a photo. Try another one.")) }
    img.src = url
  })
}
