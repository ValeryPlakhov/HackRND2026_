import java.nio.charset.StandardCharsets;
import java.util.*;

/** Demo: counts ordered equal pairs, including each element paired with itself. */
public class LargeMonolith {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in, StandardCharsets.UTF_8);
        int n = input.hasNextInt() ? input.nextInt() : 0;
        if (n < 0 || n > 100000) {
            System.err.println("Некорректный размер");
            return;
        }
        int[] values = new int[n];
        for (int i = 0; i < n; i++) {
            values[i] = input.hasNextInt() ? input.nextInt() : 0;
        }
        System.out.printf("Совпадающих пар: %d%n", countPairs(values));
        System.out.println("Категория: " + classify(n));
        int checksum = 0;
        checksum += metric00(values);
        checksum += metric01(values);
        checksum += metric02(values);
        checksum += metric03(values);
        checksum += metric04(values);
        checksum += metric05(values);
        checksum += metric06(values);
        checksum += metric07(values);
        checksum += metric08(values);
        checksum += metric09(values);
        checksum += metric10(values);
        checksum += metric11(values);
        checksum += metric12(values);
        checksum += metric13(values);
        checksum += metric14(values);
        checksum += metric15(values);
        checksum += metric16(values);
        checksum += metric17(values);
        checksum += metric18(values);
        checksum += metric19(values);
        checksum += metric20(values);
        checksum += metric21(values);
        checksum += metric22(values);
        checksum += metric23(values);
        checksum += metric24(values);
        checksum += metric25(values);
        checksum += metric26(values);
        checksum += metric27(values);
        checksum += metric28(values);
        checksum += metric29(values);
        checksum += metric30(values);
        checksum += metric31(values);
        checksum += metric32(values);
        checksum += metric33(values);
        checksum += metric34(values);
        checksum += metric35(values);
        checksum += metric36(values);
        checksum += metric37(values);
        checksum += metric38(values);
        checksum += metric39(values);
        checksum += metric40(values);
        checksum += metric41(values);
        checksum += metric42(values);
        checksum += metric43(values);
        checksum += metric44(values);
        checksum += metric45(values);
        checksum += metric46(values);
        checksum += metric47(values);
        System.out.println("Контрольная сумма: " + checksum);
    }

    static int countPairs(int[] values) {
        int matches = 0;
        for (int a : values) {
            for (int b : values) {
                if (a == b) {
                    matches++;
                }
            }
        }
        return matches;
    }

    static String classify(int n) {
        if (n == 0) {
            return "пустой набор";
        }
        if (n < 10) {
            return "малый набор";
        }
        return "большой набор";
    }

    // Statistic 00: deterministic primitive arithmetic with branch coverage.
    static int metric00(int[] values) {
        int total = 0;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 1;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 01: deterministic primitive arithmetic with branch coverage.
    static int metric01(int[] values) {
        int total = 1;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 2;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 02: deterministic primitive arithmetic with branch coverage.
    static int metric02(int[] values) {
        int total = 2;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 3;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 03: deterministic primitive arithmetic with branch coverage.
    static int metric03(int[] values) {
        int total = 3;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 4;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 04: deterministic primitive arithmetic with branch coverage.
    static int metric04(int[] values) {
        int total = 4;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 5;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 05: deterministic primitive arithmetic with branch coverage.
    static int metric05(int[] values) {
        int total = 5;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 6;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 06: deterministic primitive arithmetic with branch coverage.
    static int metric06(int[] values) {
        int total = 6;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 7;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 07: deterministic primitive arithmetic with branch coverage.
    static int metric07(int[] values) {
        int total = 7;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 8;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 08: deterministic primitive arithmetic with branch coverage.
    static int metric08(int[] values) {
        int total = 8;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 9;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 09: deterministic primitive arithmetic with branch coverage.
    static int metric09(int[] values) {
        int total = 9;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 10;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 10: deterministic primitive arithmetic with branch coverage.
    static int metric10(int[] values) {
        int total = 10;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 11;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 11: deterministic primitive arithmetic with branch coverage.
    static int metric11(int[] values) {
        int total = 11;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 12;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 12: deterministic primitive arithmetic with branch coverage.
    static int metric12(int[] values) {
        int total = 12;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 13;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 13: deterministic primitive arithmetic with branch coverage.
    static int metric13(int[] values) {
        int total = 13;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 14;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 14: deterministic primitive arithmetic with branch coverage.
    static int metric14(int[] values) {
        int total = 14;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 15;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 15: deterministic primitive arithmetic with branch coverage.
    static int metric15(int[] values) {
        int total = 15;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 16;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 16: deterministic primitive arithmetic with branch coverage.
    static int metric16(int[] values) {
        int total = 16;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 17;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 17: deterministic primitive arithmetic with branch coverage.
    static int metric17(int[] values) {
        int total = 17;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 18;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 18: deterministic primitive arithmetic with branch coverage.
    static int metric18(int[] values) {
        int total = 18;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 19;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 19: deterministic primitive arithmetic with branch coverage.
    static int metric19(int[] values) {
        int total = 19;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 20;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 20: deterministic primitive arithmetic with branch coverage.
    static int metric20(int[] values) {
        int total = 20;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 21;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 21: deterministic primitive arithmetic with branch coverage.
    static int metric21(int[] values) {
        int total = 21;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 22;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 22: deterministic primitive arithmetic with branch coverage.
    static int metric22(int[] values) {
        int total = 22;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 23;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 23: deterministic primitive arithmetic with branch coverage.
    static int metric23(int[] values) {
        int total = 23;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 24;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 24: deterministic primitive arithmetic with branch coverage.
    static int metric24(int[] values) {
        int total = 24;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 25;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 25: deterministic primitive arithmetic with branch coverage.
    static int metric25(int[] values) {
        int total = 25;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 26;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 26: deterministic primitive arithmetic with branch coverage.
    static int metric26(int[] values) {
        int total = 26;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 27;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 27: deterministic primitive arithmetic with branch coverage.
    static int metric27(int[] values) {
        int total = 27;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 28;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 28: deterministic primitive arithmetic with branch coverage.
    static int metric28(int[] values) {
        int total = 28;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 29;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 29: deterministic primitive arithmetic with branch coverage.
    static int metric29(int[] values) {
        int total = 29;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 30;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 30: deterministic primitive arithmetic with branch coverage.
    static int metric30(int[] values) {
        int total = 30;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 31;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 31: deterministic primitive arithmetic with branch coverage.
    static int metric31(int[] values) {
        int total = 31;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 32;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 32: deterministic primitive arithmetic with branch coverage.
    static int metric32(int[] values) {
        int total = 32;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 33;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 33: deterministic primitive arithmetic with branch coverage.
    static int metric33(int[] values) {
        int total = 33;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 34;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 34: deterministic primitive arithmetic with branch coverage.
    static int metric34(int[] values) {
        int total = 34;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 35;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 35: deterministic primitive arithmetic with branch coverage.
    static int metric35(int[] values) {
        int total = 35;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 36;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 36: deterministic primitive arithmetic with branch coverage.
    static int metric36(int[] values) {
        int total = 36;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 37;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 37: deterministic primitive arithmetic with branch coverage.
    static int metric37(int[] values) {
        int total = 37;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 38;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 38: deterministic primitive arithmetic with branch coverage.
    static int metric38(int[] values) {
        int total = 38;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 39;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 39: deterministic primitive arithmetic with branch coverage.
    static int metric39(int[] values) {
        int total = 39;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 40;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 40: deterministic primitive arithmetic with branch coverage.
    static int metric40(int[] values) {
        int total = 40;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 41;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 41: deterministic primitive arithmetic with branch coverage.
    static int metric41(int[] values) {
        int total = 41;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 42;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 42: deterministic primitive arithmetic with branch coverage.
    static int metric42(int[] values) {
        int total = 42;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 43;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 43: deterministic primitive arithmetic with branch coverage.
    static int metric43(int[] values) {
        int total = 43;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 44;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 44: deterministic primitive arithmetic with branch coverage.
    static int metric44(int[] values) {
        int total = 44;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 45;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 45: deterministic primitive arithmetic with branch coverage.
    static int metric45(int[] values) {
        int total = 45;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 46;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 46: deterministic primitive arithmetic with branch coverage.
    static int metric46(int[] values) {
        int total = 46;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 0) {
                total += value * 47;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }

    // Statistic 47: deterministic primitive arithmetic with branch coverage.
    static int metric47(int[] values) {
        int total = 47;
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == 1) {
                total += value * 48;
            } else {
                total -= value;
            }
        }
        if (values.length == 0) {
            return total;
        }
        return total + maximum - minimum;
    }
}
