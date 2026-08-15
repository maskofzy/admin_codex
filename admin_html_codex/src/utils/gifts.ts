import type { GiftCatalogItem } from '@/types/project';

export function giftEventFields(gift: GiftCatalogItem, count: number) {
  return {
    gift_id: gift.id,
    gift_name: gift.name,
    count,
  };
}
