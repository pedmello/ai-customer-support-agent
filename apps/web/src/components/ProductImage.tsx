import { useState } from "react";
import { safeCatalogImage } from "./ExternalProducts";
import { Icon } from './Icon';

export function ProductImage({
  imageUrl,
  title,
}: {
  imageUrl?: string | null;
  title: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const source = imageUrl ? safeCatalogImage(imageUrl) : undefined;
  return source && failedUrl !== source ? (
    <img
      className="product-image"
      src={source}
      alt={title}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(source)}
    />
  ) : (
    <span
      className="product-placeholder"
      role="img"
      aria-label={`Imagem indisponível: ${title}`}
    >
      <Icon name="box" size={23} />
    </span>
  );
}
