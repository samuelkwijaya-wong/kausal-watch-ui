import {
  collectAllDates,
  densifyTimeKeys,
} from '@/components/contentblocks/indicator-chart/indicator-charts-utility';

describe('densifyTimeKeys', () => {
  it('fills in a single skipped year', () => {
    expect(densifyTimeKeys(['2019', '2020', '2022'], 'YEAR')).toEqual([
      '2019',
      '2020',
      '2021',
      '2022',
    ]);
  });

  it('fills in several consecutive skipped years', () => {
    expect(densifyTimeKeys(['2019', '2023'], 'YEAR')).toEqual([
      '2019',
      '2020',
      '2021',
      '2022',
      '2023',
    ]);
  });

  it('leaves an already contiguous range untouched', () => {
    const keys = ['2019', '2020', '2021'];
    expect(densifyTimeKeys(keys, 'YEAR')).toEqual(keys);
  });

  it('leaves a single key untouched', () => {
    expect(densifyTimeKeys(['2019'], 'YEAR')).toEqual(['2019']);
  });

  it('leaves an empty list untouched', () => {
    expect(densifyTimeKeys([], 'YEAR')).toEqual([]);
  });

  it('fills in months across a year boundary', () => {
    expect(densifyTimeKeys(['2019-11', '2020-02'], 'MONTH')).toEqual([
      '2019-11',
      '2019-12',
      '2020-01',
      '2020-02',
    ]);
  });

  it('leaves DAY resolution untouched', () => {
    const keys = ['2019-03-15', '2019-03-19'];
    expect(densifyTimeKeys(keys, 'DAY')).toEqual(keys);
  });

  it('defaults to YEAR when the resolution is missing', () => {
    expect(densifyTimeKeys(['2019', '2021'], null)).toEqual(['2019', '2020', '2021']);
  });

  it('keeps the sparse list when the span exceeds the cap', () => {
    const keys = ['1000', '2000'];
    expect(densifyTimeKeys(keys, 'YEAR')).toEqual(keys);
  });

  it('does not attempt to fill an unsorted list', () => {
    const keys = ['2022', '2019'];
    expect(densifyTimeKeys(keys, 'YEAR')).toEqual(keys);
  });
});

describe('collectAllDates', () => {
  it('gives a skipped year its own category', () => {
    const { xCategories } = collectAllDates(
      [
        [
          ['2019', 1],
          ['2020', 2],
          ['2022', 3],
        ],
      ],
      'YEAR'
    );
    expect(xCategories).toEqual(['2019', '2020', '2021', '2022']);
  });

  it('merges gaps across several series', () => {
    const { xCategories } = collectAllDates(
      [
        [
          ['2019', 1],
          ['2022', 2],
        ],
        [['2020', 3]],
      ],
      'YEAR'
    );
    expect(xCategories).toEqual(['2019', '2020', '2021', '2022']);
  });

  it('extends the range to a goal date beyond the last value', () => {
    const { xCategories } = collectAllDates(
      [
        [
          ['2019', 1],
          ['2020', 2],
        ],
      ],
      'YEAR',
      ['2024-06-30']
    );
    expect(xCategories).toEqual(['2019', '2020', '2021', '2022', '2023', '2024']);
  });

  it('collapses dates that format to the same category', () => {
    const { xCategories } = collectAllDates([[['2030-12', 5]]], 'MONTH', ['2030-12-31']);
    expect(xCategories).toEqual(['2030-12']);
  });

  it('returns no categories for empty input', () => {
    expect(collectAllDates([], 'YEAR').xCategories).toEqual([]);
  });

  it('leaves DAY resolution sparse', () => {
    const { xCategories } = collectAllDates(
      [
        [
          ['2019-03-15', 1],
          ['2019-03-19', 2],
        ],
      ],
      'DAY'
    );
    expect(xCategories).toEqual(['2019-03-15', '2019-03-19']);
  });
});
