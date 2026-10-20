import { useState } from "react";
import { safeCatalogImage } from "./ExternalProducts";

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
      <svg
        width="23"
        height="23"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path d="m3 7 9-4 9 4v13H3V7Zm0 0 9 4 9-4M12 11v9" />
      </svg>
    </span>
  );
}
