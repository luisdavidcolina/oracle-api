async function convertDateTimeToEpoch(date_dd_mm_yy, time_hh_mm_ss, GMT_zone = "-04:00") {
    var dateParts = date_dd_mm_yy.split('/');
    var timeParts = time_hh_mm_ss.split(':');

    var dateStringToParse = `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}T${timeParts[0].padStart(2, '0')}:${timeParts[1].padStart(2, '0')}:00.000${GMT_zone}`;

    var parsedDate = Date.parse(dateStringToParse);
    var dateObject = new Date(parsedDate);
    const epoch = (dateObject.getTime()) / 1000;

    return epoch;
}

function convertTimeFormat(time) {
    const [hours, minutes] = time.split(':');
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

module.exports = {
    convertDateTimeToEpoch,
    convertTimeFormat
};
