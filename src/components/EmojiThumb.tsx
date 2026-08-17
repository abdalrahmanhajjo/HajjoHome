/** بطاقة إيموجي للمنتج/الفئة — على نمط ProductThumb في StoreFlow (بالإيموجي فقط). */
export default function EmojiThumb({
  emoji,
  size = 48,
  radius = 9,
}: {
  emoji: string
  size?: number
  radius?: number
}) {
  return (
    <div
      className="emoji-thumb"
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.5) }}
    >
      <span aria-hidden>{emoji}</span>
    </div>
  )
}
