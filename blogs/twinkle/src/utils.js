export function array_equal(arr1, arr2) {
    // Check if both arrays have the same length
    if (arr1.length !== arr2.length) {
        return false;
    }
    // Compare each element
    return arr1.every((value, index) => value === arr2[index]);
}

export function binary_search_between(arr, target) {
    // Not checking if sorted for performance reasons
    let left = 0;
    let right = arr.length - 1;
    let iter = 0; // Don't let infinite loop
    if (target > arr[right]) return [right, arr.length];
    if (target >= arr[right]) return [right, right];
    if (target < arr[left]) return [-1, left];
    while (left <= right && iter <= arr.length) {

        const mid = Math.floor((left + right) / 2);
        const midValue = arr[mid];

        if (midValue === target) {
            return [mid, mid];
        }

        if (arr[left] < target && arr[right] > target && left + 1 === right) {
            return [left, right];
        }

        if (midValue < target) {
            left = mid;
        } else {
            right = mid;
        }
        iter++;
    }
    return -1;
}


function tests() {
    console.log("Testing utils.js ...")
    var t = []
    //array_equal
    t.push(array_equal([0], 0) == false);
    t.push(array_equal([0], [0]) == true);
    t.push(array_equal([0, 1], [0]) == false);
    t.push(array_equal([0, 1], [0, 1]) == true);
    t.push(array_equal([0, 0], [0, 1]) == false);
    t.push(array_equal({ 0: 0, 1: 1 }, [0, 1]) == false);

    //binary_search_between
    t.push(array_equal(binary_search_between([0, 3, 5, 6], 4), [1, 2]));
    t.push(array_equal(binary_search_between([0, 3, 5, 6], 1), [0, 1]));
    t.push(array_equal(binary_search_between([0, 3, 5, 6], 5), [2, 2]));
    t.push(array_equal(binary_search_between([0, 3, 5, 6, 1000], 1001), [4, 5]));
    t.push(array_equal(binary_search_between([0, 3, 5, 6, 1000], -1), [-1, 0]));
    t.push(array_equal(binary_search_between([0, 3, 5, 6, 1000], 0), [0, 0]));
    // t.push(array_equal(binary_search_between([0,3,5,6,1000], 1000), [4, 4]));
    let allTrue = t.every(e => e === true);
    if (allTrue) {
        console.log("All", t.length, "tests of utils.js passed!")
    } else {
        for (let i = 0; i < t.length; i++) {
            if (!t[i]) {
                console.log("Test", i + 1, "/", t.length, "of utils.js failed")
            }
        }
    }
    return allTrue

}
tests()