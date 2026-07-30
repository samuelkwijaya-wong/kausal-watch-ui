import type { LineChartVisualizationFragment } from '@/common/__generated__/graphql';
import { linearRegression } from '@/common/math';

type LineChartBlock = Omit<
  Extract<LineChartVisualizationFragment, { __typename: 'DashboardIndicatorLineChartBlock' }>,
  '__typename'
>;

type TFunction = (key: string) => string;

export const X_SYMBOL =
  'path://M0.979266 20.7782C-0.192306 21.9497 -0.192307 23.8492 0.979266 25.0208C2.15084 26.1924 4.05033 26.1924 5.22191 ' +
  '25.0208L13.0001 17.2426L20.7783 25.0208C21.9498 26.1924 23.8493 26.1924 25.0209 25.0208C26.1925 23.8492 26.1925 21.9497 ' +
  '25.0209 20.7782L17.2427 13L25.0209 5.22181C26.1925 4.05024 26.1925 2.15075 25.0209 0.979174C23.8493 -0.192399 21.9498 ' +
  '-0.192399 20.7783 0.979174L13.0001 8.75735L5.22191 0.979175C4.05033 -0.192398 2.15084 -0.192398 0.979266 0.979175C-0.192307 ' +
  '2.15075 -0.192307 4.05024 0.979266 5.22182L8.75744 13L0.979266 20.7782Z';

export interface GraphsTheme {
  categoryColors?: string[];
  totalLineColor?: string;
  trendLineColor?: string;
  goalLineColors?: string[];
  showTrendline?: boolean;
}

function formatDateKey(date: string, timeResolution?: string | null): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;

  const resolution = String(timeResolution || 'YEAR').toUpperCase();
  if (resolution === 'YEAR') {
    return String(d.getUTCFullYear());
  } else if (resolution === 'MONTH') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  } else {
    return d.toISOString().split('T')[0];
  }
}

function getTimeKeyForSorting(key: string, timeResolution?: string | null): number {
  if (timeResolution === 'YEAR') {
    return parseInt(key, 10);
  } else if (timeResolution === 'MONTH') {
    const [year, month] = key.split('-').map(Number);
    return year * 12 + (month - 1);
  } else {
    return new Date(key).getTime();
  }
}

/**
 * Inverse of getTimeKeyForSorting: turns a sort index back into a time key.
 *
 * Branches on timeResolution exactly as getTimeKeyForSorting does — including
 * not defaulting to YEAR — so that the two stay in step for any input.
 */
function timeKeyFromSortIndex(index: number, timeResolution?: string | null): string {
  if (timeResolution === 'YEAR') {
    return String(index);
  } else if (timeResolution === 'MONTH') {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  } else {
    return new Date(index).toISOString().split('T')[0];
  }
}

/** Upper bound on generated categories; beyond this we keep the sparse axis. */
const MAX_DENSE_TIME_STEPS = 600;

/**
 * Fills in the time steps missing between the first and last key so that the
 * axis is evenly spaced in time. A skipped period becomes a tick with no data
 * point, instead of vanishing and making the surrounding slope look shallower
 * than it is.
 *
 * DAY resolution is returned untouched — filling in every calendar day would
 * explode the category count for no real benefit.
 *
 * @param sortedKeys - Time keys in chronological order, as produced by formatDateKey
 * @param timeResolution - The indicator's time resolution
 */
export function densifyTimeKeys(sortedKeys: string[], timeResolution?: string | null): string[] {
  const resolution = String(timeResolution || 'YEAR').toUpperCase();
  if (resolution !== 'YEAR' && resolution !== 'MONTH') {
    return sortedKeys;
  }
  if (sortedKeys.length < 2) {
    return sortedKeys;
  }

  const indices = sortedKeys.map((key) => getTimeKeyForSorting(key, resolution));
  if (indices.some((index) => !Number.isFinite(index))) {
    return sortedKeys;
  }

  const first = indices[0];
  const stepCount = indices[indices.length - 1] - first + 1;
  if (stepCount <= sortedKeys.length) {
    // Already dense (or unsorted input we shouldn't second-guess)
    return sortedKeys;
  }
  if (stepCount > MAX_DENSE_TIME_STEPS) {
    return sortedKeys;
  }

  return Array.from({ length: stepCount }, (_, i) => timeKeyFromSortIndex(first + i, resolution));
}

export function buildDimSeries(
  chartSeries: LineChartBlock['chartSeries'],
  palette: string[],
  timeResolution?: string | null
) {
  const dimCategoryMap = new Map<
    string,
    { color: string; values: { date: string | null; value: number }[] }
  >();

  (chartSeries ?? [])
    .filter((s) => s != null)
    .filter((s) => s.dimensionCategory)
    .forEach((s) => {
      const name = s.dimensionCategory!.name;
      const fallbackColor = palette[Array.from(dimCategoryMap.keys()).length % palette.length];
      const rawColor = s.dimensionCategory!.defaultColor;
      const color = rawColor && rawColor.trim() !== '' ? rawColor : fallbackColor;

      if (!dimCategoryMap.has(name)) {
        dimCategoryMap.set(name, { color, values: [] });
      }

      dimCategoryMap.get(name)!.values.push(...s.values.filter((v) => v != null));
    });

  return Array.from(dimCategoryMap.entries()).map(([name, { color, values }]) => {
    const timeMap = new Map<string, number>();
    values.forEach((v) => {
      if (v.value != null && v.date) {
        const key = formatDateKey(v.date, timeResolution);
        timeMap.set(key, (timeMap.get(key) || 0) + v.value);
      }
    });
    const raw = Array.from(timeMap.entries())
      .map(([key, value]) => [key, value] as [string, number])
      .sort(
        (a, b) =>
          getTimeKeyForSorting(a[0], timeResolution) - getTimeKeyForSorting(b[0], timeResolution)
      );
    return { name, color, raw };
  });
}

export function buildTotalSeries(
  chartSeries: LineChartBlock['chartSeries'],
  totalLineColor: string,
  label = 'Total',
  timeResolution?: string | null
) {
  const totalMap = new Map<string, number>();
  (chartSeries ?? [])
    .filter((s) => s != null)
    .find((s) => !s.dimensionCategory)
    ?.values.filter((v) => v != null)
    .forEach((v) => {
      if (v.date) {
        const key = formatDateKey(v.date, timeResolution);
        totalMap.set(key, (totalMap.get(key) || 0) + v.value);
      }
    });

  const totalRaw = Array.from(totalMap.entries())
    .map(([key, value]) => [key, value] as [string, number])
    .sort(
      (a, b) =>
        getTimeKeyForSorting(a[0], timeResolution) - getTimeKeyForSorting(b[0], timeResolution)
    );
  return {
    name: label,
    color: totalLineColor,
    raw: totalRaw,
  };
}

export function buildGoalSeries(
  indicator: LineChartBlock['indicator'],
  unit: string,
  goalLineColors: string[],
  label = 'Goal',
  timeResolution?: string | null
) {
  return (
    indicator?.goals
      ?.filter((g) => g?.date != null)
      .map((g) => {
        const key = formatDateKey(g!.date!, timeResolution);
        return {
          name: label,
          type: 'scatter' as const,
          symbol: X_SYMBOL,
          symbolSize: 10,
          data: [[key, g!.value]],
          itemStyle: { color: goalLineColors?.[0] ?? '#3E9C88' },
          tooltip: { formatter: `Goal: ${g!.value} ${unit}` },
        };
      }) ?? []
  );
}

export function buildTrendSeries(
  totalRaw: [string, number][],
  indicator: LineChartBlock['indicator'],
  trendLineColor: string,
  label = 'Trend',
  timeResolution?: string | null
) {
  const regData = totalRaw.slice(-Math.min(totalRaw.length, 10));
  const predictedTimes = regData.map(([key]) => getTimeKeyForSorting(key, timeResolution));

  if (indicator?.goals?.length) {
    const goalTimes = indicator.goals
      .map((g) => g?.date)
      .filter((d) => d != null)
      .map((d) => getTimeKeyForSorting(formatDateKey(d, timeResolution), timeResolution));
    if (goalTimes.length) {
      const highestGoalTime = Math.max(...goalTimes);
      if (highestGoalTime > predictedTimes[predictedTimes.length - 1]) {
        predictedTimes.push(highestGoalTime);
      }
    }
  }

  const numericData = regData.map(
    ([key, value]) => [getTimeKeyForSorting(key, timeResolution), value] as [number, number]
  );
  const model = linearRegression(numericData);
  const predictedValues = predictedTimes.map((timeKey) => model.m * timeKey + model.b);

  const predictedKeys = predictedTimes.map((timeKey) =>
    timeKeyFromSortIndex(timeKey, timeResolution)
  );

  return regData.length >= 2 && (indicator?.showTrendline ?? true)
    ? [
        {
          name: label,
          type: 'line' as const,
          symbol: 'none',
          showSymbol: false,
          smooth: false,
          data: predictedKeys.map((key, i) => [key, predictedValues[i]] as [string, number]),
          lineStyle: { type: 'dashed', width: 2, color: trendLineColor },
          itemStyle: { color: trendLineColor },
          tooltip: { show: false },
        },
      ]
    : [];
}

export function buildTooltipFormatter(
  unit: string,
  legendData: string[],
  t: TFunction,
  formatValue: (value: number) => string,
  dimension?: { name: string },
  timeResolution?: string | null
) {
  return (params: any[]) => {
    const processedSeries = new Set<string>();
    const paramsArray = Array.isArray(params) ? params : [params];
    const timeKey = paramsArray[0]?.axisValue;

    let formattedTime: string;
    if (timeResolution === 'YEAR') {
      formattedTime = String(timeKey);
    } else if (timeResolution === 'MONTH') {
      formattedTime = String(timeKey);
    } else {
      const date = new Date(timeKey);
      formattedTime = Number.isNaN(date.getTime())
        ? String(timeKey)
        : date.toISOString().split('T')[0];
    }

    const rows = paramsArray
      .filter((p) => {
        if (!legendData.includes(p.seriesName)) return false;
        if (processedSeries.has(p.seriesName)) return false;
        processedSeries.add(p.seriesName);
        return true;
      })
      .map((p) => {
        const value =
          Array.isArray(p.data) && typeof p.data[1] === 'number'
            ? formatValue(p.data[1])
            : typeof p.data === 'number'
              ? formatValue(p.data)
              : '-';

        const label = dimension ? p.seriesName : p.seriesName;

        return `${p.marker} ${label}: ${value} ${unit}`;
      });

    // Skipped time steps have a tick but no data; suppress the empty tooltip.
    if (!rows.length) {
      return '';
    }

    return `<strong>${formattedTime}</strong><br/>${rows.join('<br/>')}`;
  };
}

export function buildYAxisConfig(
  unit: string,
  formatValue: (value: number) => string,
  indicator?: {
    minValue?: number | null;
    maxValue?: number | null;
    ticksCount?: number | null;
  },
  color?: string
) {
  const yAxis: any = {
    type: 'value',
    name: unit,
    nameTextStyle: {
      align: 'left',
      padding: [0, 0, 0, -25],
      fontSize: 12,
    },
    axisLabel: {
      color,
      formatter: formatValue,
    },
  };

  if (typeof indicator?.minValue === 'number') {
    yAxis.min = indicator.minValue;
  }
  if (typeof indicator?.maxValue === 'number') {
    yAxis.max = indicator.maxValue;
  }
  if (typeof indicator?.ticksCount === 'number') {
    yAxis.splitNumber = indicator.ticksCount;
  }

  return yAxis;
}

/**
 * Normalizes a date key to a consistent format for use in Sets/Maps.
 * Converts numbers (years) and date strings to a normalized format.
 */
export function normalizeDateForSet(
  key: string | number,
  timeResolution: string | null | undefined
): string {
  if (typeof key === 'number') {
    if (key > 1900 && key < 2100) {
      return `${key}-01-01`;
    }
    return String(key);
  }
  const dateObj = new Date(key);
  if (Number.isNaN(dateObj.getTime())) {
    return String(key);
  }
  if (timeResolution === 'YEAR') {
    return `${dateObj.getUTCFullYear()}-01-01`;
  }
  return key;
}

/**
 * Formats a normalized date string for display based on time resolution.
 */
export function formatDateForDisplay(
  normalizedDate: string,
  timeResolution: string | null | undefined
): string {
  const date = new Date(normalizedDate);
  if (Number.isNaN(date.getTime())) {
    return normalizedDate;
  }
  if (timeResolution === 'YEAR') {
    return String(date.getUTCFullYear());
  } else if (timeResolution === 'MONTH') {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  } else {
    return date.toISOString().split('T')[0];
  }
}

/**
 * Sorts an array of normalized date strings chronologically.
 */
export function sortDates(dates: string[]): string[] {
  return [...dates].sort((a, b) => {
    const dateA = new Date(a).getTime();
    const dateB = new Date(b).getTime();
    if (Number.isNaN(dateA) || Number.isNaN(dateB)) {
      return String(a).localeCompare(String(b));
    }
    return dateA - dateB;
  });
}

/**
 * Collects and sorts all unique dates from multiple raw series arrays.
 * Returns both the sorted normalized dates and the display-formatted categories.
 */
export function collectAllDates(
  sources: Array<[string, number][]>,
  timeResolution: string | null | undefined,
  additionalDates?: (string | number)[]
): { allDates: string[]; xCategories: string[] } {
  const normalizedDateSet = new Set<string>();

  sources.forEach((raw) =>
    raw.forEach(([key]) => normalizedDateSet.add(normalizeDateForSet(key, timeResolution)))
  );

  additionalDates?.forEach((date) =>
    normalizedDateSet.add(normalizeDateForSet(date, timeResolution))
  );

  const allDates = sortDates(Array.from(normalizedDateSet));
  // Deduplicate in display space: distinct normalized dates can format to the
  // same key (e.g. a value on 2030-12-01 and a goal on 2030-12-31 at MONTH
  // resolution), which would otherwise produce a repeated category.
  const displayKeys = Array.from(
    new Set(allDates.map((d) => formatDateForDisplay(d, timeResolution)))
  );
  const xCategories = densifyTimeKeys(displayKeys, timeResolution);

  return { allDates, xCategories };
}
