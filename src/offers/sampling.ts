/** Fisher-Yates — não muda o array recebido. */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * Reparte `target` vagas entre pools de tamanhos diferentes: cada pool não-vazio
 * leva ao menos 1, e o restante vai proporcional ao tamanho (método D'Hondt),
 * sem nunca pedir mais do que o pool tem.
 *
 * Sem o mínimo, uma seção pequena (Moda, 8 itens) quase nunca sairia sorteada
 * ao lado de uma grande (Perfumes, 48).
 *
 * Quando há menos vagas que pools, os primeiros da lista levam 1 — cabe ao
 * chamador embaralhar a ordem dos pools para que isso não privilegie sempre os
 * mesmos.
 */
export function allocateProportionalWithMin(sizes: readonly number[], target: number): number[] {
  const count = sizes.length;
  const quotas = new Array<number>(count).fill(0);
  if (count === 0 || target <= 0) return quotas;

  for (let i = 0; i < count && target > 0; i++) {
    if ((sizes[i] ?? 0) > 0) {
      quotas[i] = 1;
      target--;
    }
  }

  while (target > 0) {
    let best = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < count; i++) {
      const size = sizes[i] ?? 0;
      if ((quotas[i] ?? 0) >= size) continue;
      const score = size / ((quotas[i] ?? 0) + 1);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }

    if (best < 0) break;
    quotas[best] = (quotas[best] ?? 0) + 1;
    target--;
  }

  return quotas;
}
