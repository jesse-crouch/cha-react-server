export function time(date) {
    var hours = date.getUTCHours();
    var mins = date.getUTCMinutes();
    var endStamp = (hours >= 12) ? ' PM' : ' AM';

    var timeString = (hours > 12) ? (hours -= 12) : hours;
    timeString += ':' + ((mins === 0) ? '00' : mins) + endStamp;

    return timeString;
}

export function dateString(date) {
    // DD/MM/YYYY
    var day = date.getUTCDate();
    var month = date.getUTCMonth();
    var year = date.getUTCFullYear();

    if (day < 10) { day = '0' + day; }
    if (month < 10) { month = '0' + month; }
    
    return day + '/' + month + '/' + year;
}