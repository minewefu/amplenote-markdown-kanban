/** Small, explicit date-pattern vocabulary; bracketed text is literal. */
export function formatDatePattern(date,pattern,locale) {
  if(!(date instanceof Date)||Number.isNaN(date.getTime()))return "";
  const pad=value=>String(value).padStart(2,"0");
  const hour=date.getHours(),offset=-date.getTimezoneOffset(),sign=offset<0?"-":"+";
  const zone=sign+pad(Math.floor(Math.abs(offset)/60))+":"+pad(Math.abs(offset)%60);
  const tokens={
    YYYY:String(date.getFullYear()).padStart(4,"0"),YY:pad(date.getFullYear()%100),
    MMMM:date.toLocaleDateString(locale,{month:"long"}),MMM:date.toLocaleDateString(locale,{month:"short"}),MM:pad(date.getMonth()+1),M:String(date.getMonth()+1),
    dddd:date.toLocaleDateString(locale,{weekday:"long"}),ddd:date.toLocaleDateString(locale,{weekday:"short"}),DD:pad(date.getDate()),D:String(date.getDate()),
    HH:pad(hour),H:String(hour),hh:pad(hour%12||12),h:String(hour%12||12),mm:pad(date.getMinutes()),m:String(date.getMinutes()),ss:pad(date.getSeconds()),s:String(date.getSeconds()),
    A:hour<12?"AM":"PM",a:hour<12?"am":"pm",Z:zone,ZZ:zone.replace(":","")
  };
  return String(pattern).replace(/\[[^\]]*\]|YYYY|MMMM|dddd|MMM|ddd|YY|MM|DD|HH|hh|mm|ss|ZZ|M|D|H|h|m|s|A|a|Z/g,token=>token.startsWith("[")?token.slice(1,-1):tokens[token]);
}
