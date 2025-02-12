/**
 * Performs a binary search over a sorted array.
 * @param arr The array to search.
 * @param value The value to search.
 * @param comparator function receiving two arguments and
 *                   returning a number. It must return zero if the two
 *                   values are equal, a positive value if the first
 *                   argument is greater than the second, and a negative
 *                   value otherwise. The first argument is the searched
 *                   value while the second argument is the value form
 *                   the array.
 *
 * @returns The index closest to the searched value. You should
 *                   test whether the value at the value at the returned index
 *                   is equal to the searched value. If not, the value doesn't
 *                   exist in the array.
 */
export function bsearch<T>(
  arr: readonly T[],
  value: T,
  comparator: (x: T, y: T) => number = (x, y) => (x > y ? 1 : x < y ? -1 : 0),
): number {
  if (!arr || arr.length <= 0) {
    return 0;
  }

  let start = 0;
  let end = arr.length - 1;
  while (start < end) {
    const mid = ((start + end) / 2) | 0;
    const r = comparator(value, arr[mid]);
    if (r === 0) {
      return mid;
    }
    if (r < 0) {
      end = mid - 1;
    } else {
      start = mid + 1;
    }
  }
  // Fixup the result so it's always "before" the target index enabling
  // standard array ops on the unmodified result.
  return comparator(value, arr[start]) > 0 ? start + 1 : start;
}

/**
 * Performs a binary search over a range of indices.
 * @param length The length of the range to search (0 to length-1).
 * @param comparator Function receiving an index and returning a number.
 *                  It must return zero if the index is the target,
 *                  a positive value if the target is after this index,
 *                  and a negative value if the target is before this index.
 *
 * @returns The index closest to where the target would be. You should
 *          test whether the comparator returns 0 for the returned index
 *          to determine if the target was actually found. Returns -1 if
 *          length is 0 or if the target was not found.
 */
export function bsearch_idx(
  length: number,
  comparator: (idx: number) => number = (_idx) => {
    throw new Error('Bad comparator');
  },
): number {
  if (!length) {
    return -1;
  }

  let start = 0;
  let end = length - 1;
  while (start < end) {
    const mid = ((start + end) / 2) | 0;
    const r = comparator(mid);
    if (!r) {
      return mid;
    }
    if (r < 0) {
      end = mid - 1;
    } else {
      start = mid + 1;
    }
  }
  const res = comparator(start) > 0 ? start + 1 : start;
  return res < length ? res : -1;
}
