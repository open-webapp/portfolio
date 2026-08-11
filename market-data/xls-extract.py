#!/usr/bin/env python3

import argparse
import csv
import os
import sys

import xlrd


def extract_xls(filename, columns):
    """
    Extract specified 1-based columns from the first worksheet.
    Returns (header, rows).
    """
    workbook = xlrd.open_workbook(filename)
    sheet = workbook.sheet_by_index(0)

    # Convert from 1-based column numbers to 0-based indexes
    col_indexes = [c - 1 for c in columns]

    # Validate column numbers
    for col in col_indexes:
        if col < 0 or col >= sheet.ncols:
            raise ValueError(
                f"{filename}: column {col + 1} does not exist "
                f"(sheet has {sheet.ncols} columns)"
            )

    # First row is treated as the header
    header = [sheet.cell_value(0, col) for col in col_indexes]

    rows = []

    for row_idx in range(1, sheet.nrows):
        values = [sheet.cell_value(row_idx, col) for col in col_indexes]

        # Skip completely empty rows
        if any(str(value).strip() for value in values):
            rows.append(values)

    return header, rows


def main():
    parser = argparse.ArgumentParser(
        description="Extract selected columns from one or more XLS files into a CSV."
    )

    parser.add_argument(
        "files",
        nargs="+",
        help="Input XLS files"
    )

    parser.add_argument(
        "-c",
        "--cols",
        nargs="+",
        type=int,
        required=True,
        help="Column numbers to extract (1-based), e.g. --cols 1 3 7"
    )

    parser.add_argument(
        "-o",
        "--output",
        required=True,
        help="Output CSV file"
    )

    args = parser.parse_args()

    # Validate column numbers
    if any(c < 1 for c in args.cols):
        parser.error("Column numbers must be 1 or greater.")

    try:
        with open(args.output, "w", newline="", encoding="utf-8") as csvfile:
            writer = csv.writer(csvfile)

            header_written = False
            total_rows = 0

            for filename in args.files:
                if not os.path.isfile(filename):
                    print(
                        f"Warning: file not found, skipping: {filename}",
                        file=sys.stderr
                    )
                    continue

                print(f"Processing {filename}...", file=sys.stderr)

                try:
                    header, rows = extract_xls(filename, args.cols)

                    # Write header only once
                    if not header_written:
                        writer.writerow(header)
                        header_written = True

                    writer.writerows(rows)
                    total_rows += len(rows)

                except Exception as e:
                    print(
                        f"Error processing {filename}: {e}",
                        file=sys.stderr
                    )

        print(
            f"Wrote {total_rows} rows to {args.output}",
            file=sys.stderr
        )

    except OSError as e:
        print(f"Error opening output file: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
