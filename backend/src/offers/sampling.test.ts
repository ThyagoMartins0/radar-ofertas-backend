import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocateProportionalWithMin, shuffle } from './sampling.js';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('allocateProportionalWithMin', () => {
  it('dá pelo menos 1 para a seção pequena e reparte o resto proporcional', () => {
    // Perfumes 48, Moda 8, Smartwatches 45 — 10 vagas.
    const quotas = allocateProportionalWithMin([48, 8, 45], 10);
    assert.equal(sum(quotas), 10);
    assert.ok(quotas[1]! >= 1, 'Moda não pode ficar de fora');
    assert.ok(quotas[0]! > quotas[1]!, 'Perfumes leva mais que Moda');
  });

  it('nunca pede mais do que o pool tem', () => {
    const sizes = [2, 100];
    const quotas = allocateProportionalWithMin(sizes, 50);
    assert.equal(sum(quotas), 50);
    quotas.forEach((q, i) => assert.ok(q <= sizes[i]!, `pool ${i}: ${q} > ${sizes[i]}`));
    // 2 de 102 é ~2% do total, então leva o mínimo e não "2 porque tem 2".
    assert.equal(quotas[0], 1);
  });

  it('esgota o pool pequeno antes de estourar a capacidade dele', () => {
    const sizes = [2, 3];
    const quotas = allocateProportionalWithMin(sizes, 5);
    assert.deepEqual(quotas, [2, 3]);
  });

  it('respeita a capacidade total quando o alvo não cabe', () => {
    const quotas = allocateProportionalWithMin([3, 4], 20);
    assert.deepEqual(quotas, [3, 4]);
  });

  it('com menos vagas que seções, distribui 1 para as primeiras', () => {
    const quotas = allocateProportionalWithMin([48, 8, 45, 46, 29], 3);
    assert.equal(sum(quotas), 3);
    assert.deepEqual(quotas, [1, 1, 1, 0, 0]);
  });

  it('ignora pools vazios', () => {
    const quotas = allocateProportionalWithMin([0, 10, 0], 4);
    assert.equal(quotas[0], 0);
    assert.equal(quotas[2], 0);
    assert.equal(quotas[1], 4);
  });

  it('devolve zeros para alvo zero ou lista vazia', () => {
    assert.deepEqual(allocateProportionalWithMin([10, 20], 0), [0, 0]);
    assert.deepEqual(allocateProportionalWithMin([], 5), []);
  });

  it('as 7 seções reais cabem todas em 10 vagas', () => {
    // Tamanhos medidos no ML: relâmpago, esportes, moda, perfumes, som, mercado, watch.
    const quotas = allocateProportionalWithMin([40, 29, 8, 48, 45, 46, 45], 10);
    assert.equal(sum(quotas), 10);
    assert.ok(
      quotas.every((q) => q >= 1),
      'toda seção ativa entra no sorteio',
    );
  });
});

describe('shuffle', () => {
  it('preserva os elementos e não muda o array original', () => {
    const original = [1, 2, 3, 4, 5];
    const result = shuffle(original);
    assert.deepEqual(original, [1, 2, 3, 4, 5]);
    assert.deepEqual(
      [...result].sort((a, b) => a - b),
      original,
    );
  });

  it('embaralha de fato ao longo de várias execuções', () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const ordens = new Set(Array.from({ length: 30 }, () => shuffle(input).join(',')));
    assert.ok(ordens.size > 1, 'não pode devolver sempre a mesma ordem');
  });
});
