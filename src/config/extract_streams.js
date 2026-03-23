const fs = require('fs');

try {
    const content = fs.readFileSync('src/controllers/process_oracle.js', 'utf8');

    // Find where the datastreams array starts
    const startStr = 'let jsonWorkforceDataStreams = `[';
    let startIndex = content.indexOf(startStr);

    if (startIndex !== -1) {
        // Adjust index to point exactly at the beginning of the `[` bracket
        startIndex = startIndex + 'let jsonWorkforceDataStreams = `'.length;

        // Find the closing backtick
        const endIndex = content.indexOf('`', startIndex);

        if (endIndex !== -1) {
            const jsonStr = content.substring(startIndex, endIndex);
            console.log(`Extracted string length: ${jsonStr.length}`);

            try {
                const arr = JSON.parse(jsonStr);
                const map = {};

                arr.forEach(item => {
                    if (item.name) {
                        map[item.name.toLowerCase().replace(/\s+/g, '')] = item.id;
                    }
                });

                fs.writeFileSync('src/config/datastreams.json', JSON.stringify(map, null, 2));
                console.log('Successfully extracted datastreams. Configuration saved to src/config/datastreams.json!');

            } catch (err) {
                console.error('Failed to parse the extracted JSON string:', err.message);
                fs.writeFileSync('debug_error.log', jsonStr.substring(0, 500) + '\n\n... (truncated) ...\n\n' + jsonStr.slice(-500));
            }
        } else {
            console.error('Found the start marker, but could not find the closing backtick.');
        }
    } else {
        console.error('Start marker not found in src/controllers/process_oracle.js');
    }
} catch (e) {
    console.error('Error reading file:', e);
}
