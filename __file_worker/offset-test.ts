const LINE_DELIMITER_BYTE = 10; // '\n'

async function measureOffsetCalculation(filePath: string) {
  console.log('Starting offset calculation test...');

  const fileContent = await Deno.readFile(filePath);
  console.log(
    `File size: ${(fileContent.byteLength / 1024 / 1024).toFixed(3)} MB`
  );

  const offsetStart = performance.now();

  let totalOffset = 0;
  let lineCount = 0;
  let objectBufOffset = 0;
  let lastGoodFileOffset = 0;

  let readBufStart = 0;
  let readBufEnd = 0;

  while (readBufStart < fileContent.byteLength) {
    readBufEnd = readBufStart;

    while (
      readBufEnd < fileContent.byteLength &&
      fileContent[readBufEnd] !== LINE_DELIMITER_BYTE
    ) {
      ++readBufEnd;
    }

    const readLen = readBufEnd - readBufStart;

    if (readLen > 0) {
      totalOffset += readLen;
      objectBufOffset += readLen;
    }

    readBufStart = readBufEnd + 1;

    if (
      fileContent[readBufEnd] === LINE_DELIMITER_BYTE &&
      objectBufOffset > 0
    ) {
      lineCount++;
      lastGoodFileOffset += objectBufOffset + 1;
      objectBufOffset = 0;
    }
  }

  const offsetEnd = performance.now();
  const totalOffsetTime = offsetEnd - offsetStart;

  console.log('\nResults:');
  console.log(
    `Total bytes processed: ${(fileContent.byteLength / 1024 / 1024).toFixed(
      2
    )} MB`
  );
  console.log(`Number of lines found: ${lineCount.toLocaleString()}`);
  console.log(`Total calculated offset: ${totalOffset.toLocaleString()} bytes`);

  console.log(
    `Pure offset calculation took: ${(totalOffsetTime / 1000).toFixed(
      3
    )} seconds`
  );
}

if (import.meta.main) {
  const filePath =
    '/Users/amit-steiner/Documents/Amit/goatDB/test/notes1M.jsonl';
  await measureOffsetCalculation(filePath);
}
