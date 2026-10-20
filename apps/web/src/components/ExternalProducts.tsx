import type { ProductResult } from "../types";

export function safeCatalogImage(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "fakestoreapi.com"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function ExternalProducts({ products }: { products: ProductResult[] }) {
  return products.map((result) => (
    <section className="external-product card" key={result.productId}>
      {result.status === "AVAILABLE" && result.product ? (
        <>
          {safeCatalogImage(result.product.image) && (
            <img
              src={safeCatalogImage(result.product.image)}
              alt={result.product.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          )}
          <h2>{result.product.title}</h2>
          <small>Catálogo complementar · {result.product.category}</small>
          <p>{result.product.description}</p>
        </>
      ) : (
        <p>
          Informações complementares do produto #{result.productId}{" "}
          indisponíveis.
        </p>
      )}
    </section>
  ));
}
