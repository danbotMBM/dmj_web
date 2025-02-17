export function array_equal(arr1, arr2) {
    // Check if both arrays have the same length
    if (arr1.length !== arr2.length) {
        return false;
    }
    // Compare each element
    return arr1.every((value, index) => value === arr2[index]);
}