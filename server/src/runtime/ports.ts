// 端口槽位：预览从 base 起按槽位递增（client = base + slot*2，api = base + slot*2 + 1）。
export class PortSlots {
  private readonly used = new Set<number>()

  constructor(
    private readonly base: number,
    private readonly capacity: number,
  ) {}

  allocate(): { slot: number; clientPort: number; apiPort: number } | null {
    for (let slot = 0; slot < this.capacity; slot += 1) {
      if (this.used.has(slot)) continue
      this.used.add(slot)
      return { slot, clientPort: this.base + slot * 2, apiPort: this.base + slot * 2 + 1 }
    }
    return null
  }

  release(slot: number): void {
    this.used.delete(slot)
  }

  get active(): number {
    return this.used.size
  }
}