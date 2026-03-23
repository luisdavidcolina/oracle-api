# Oracle Webhook Processing (Backup / Reference)

This file contains the queries and Javascript step used in the Oracle Web site (Query Engine) to process the webhook data before sending it to this integration endpoint.

## Query Engine Step 1: customStep
**Active:** Yes (Enabled, Include in export)

```sql
SELECT
  DD.guestCheckID as `guestCheckID`,
  DD.revenueCenterName as `revenueCenterName`,
  DD.locationName as `locationName`,
  DD.lastTransactionDateTime as `transactionDateTime`,
  DD.subTotal as `amount`,
  DD.orderTypeName as `orderTypeName`
FROM guestCheckHeaders1() DD
```

## Query Engine Step 2: customStep
**Active:** Yes (Enabled, Include in export)

```sql
SELECT 
  DS.guestCheckID as `guestCheckID`,
  DS.guestCheckLineItemID as `guestCheckLineItemID`,
  DS.transactionDateTime as `transactionDateTime`,
  DS.locationName as `locationName`,
  DS.menuItemName1 as `menuItemName1`,
  DS.majorGroupName as `majorGroupName`,
  DS.reportLineTotal as `reportLineTotal`,
  DS.reportlineCount as `reportlineCount`,
  DS.revenueCenterName as `revenueCenterName`
FROM guestCheckMenuItems2() DS
```

## Javascript Step: customStep
**Active:** Yes (Enabled)

```javascript
var input = step1;
var output = [];

const groupedData = {};
var i = 0;
for (i = 0; i < input.length; i++) {
    var transaction = input[i];
    var t = input[i];
    if (!t || !t.transactionDateTime || !t.revenueCenterName || !t.locationName || typeof t.amount !== 'number') {
        continue;
    }
    var revenueCenter = transaction.revenueCenterName;
    var locationName = transaction.locationName;
    const transactionDateTime = new Date(transaction.transactionDateTime);

    const roundedMinutes = Math.floor(transactionDateTime.getMinutes() / 15) * 15;
    transactionDateTime.setMinutes(roundedMinutes, 0, 0);

    const timeKey = `${transactionDateTime.toISOString()}_${revenueCenter}`;
    
    const dataStreamNames = [
        `Sales(${locationName}${revenueCenter})`, 
        `Checks(${locationName}${revenueCenter})`
    ];
    const dataTypes = ['sales', 'checks'];
    
    if (!groupedData[timeKey]) {
        groupedData[timeKey] = {
            Time: `${transactionDateTime.getHours()}:${transactionDateTime.getMinutes()}`,
            Date: `${transactionDateTime.getDate()}/${transactionDateTime.getMonth() + 1}/${transactionDateTime.getFullYear()}`,
            'Data Point': ['0.00', '0'],
            'Data Type': dataTypes,
            'Data Stream Name': dataStreamNames,
        };
    }

    groupedData[timeKey]['Data Point'][0] = (parseFloat(groupedData[timeKey]['Data Point'][0]) + transaction.amount).toFixed(2);

    let checksAdjustment = transaction.amount >= 0 ? 1 : -1;
    groupedData[timeKey]['Data Point'][1] = (parseInt(groupedData[timeKey]['Data Point'][1]) + checksAdjustment).toString();
}

input = step2;

var allowedRevenueCenters = ['Starbucks Cafe', 'Door Dash', 'Drive Thru', 'Uber Eats'];

var i = 0;

var newGroupedData = {};

for (i = 0; i < input.length; i++) {
    var majorGroupName = input[i].majorGroupName;
    var transactionDateTime = new Date(input[i].transactionDateTime);
    var reportLineTotal = input[i].reportLineTotal;
    var reportlineCount = input[i].reportlineCount;
    var revenueCenterName =  input[i].revenueCenterName;
    var locationName = input[i].locationName;

    if (locationName === 'Plaza Olmedo') {

        var plazaOlmedoAllowedRevenueCenters = ['Starbucks Cafe', 'Door Dash', 'Uber Eats'];

        if (plazaOlmedoAllowedRevenueCenters.includes(revenueCenterName)) {
            const roundedMinutes = Math.floor(transactionDateTime.getMinutes() / 15) * 15;
            transactionDateTime.setMinutes(roundedMinutes, 0, 0);
    
            const timeKey = transactionDateTime.toISOString() + '_' + majorGroupName;
            const dataStreamName = 'Sales CountC(' + locationName + majorGroupName + ')';
    
            if (!newGroupedData[timeKey]) {
                newGroupedData[timeKey] = {
                    Time: transactionDateTime.getHours() + ':' + transactionDateTime.getMinutes(),
                    Date: transactionDateTime.getDate() + '/' + (transactionDateTime.getMonth() + 1) + '/' + transactionDateTime.getFullYear(),
                    'Data Point': '0',
                    'Data Type': 'sales count',
                    'Data Stream Name': dataStreamName,
                };
            }
    
            var adjustment = 0;
            if (reportLineTotal >= 0) {
                adjustment = reportlineCount;
            } else if (reportLineTotal < 0) {
                adjustment = -Math.abs(reportlineCount);
            } 
    
            newGroupedData[timeKey]['Data Point'] = (parseInt(newGroupedData[timeKey]['Data Point']) + adjustment).toString();
        } else if (revenueCenterName === 'Drive Thru') {
            const roundedMinutes = Math.floor(transactionDateTime.getMinutes() / 15) * 15;
            transactionDateTime.setMinutes(roundedMinutes, 0, 0);
    
            const timeKey = transactionDateTime.toISOString() + '_' + majorGroupName;
            const dataStreamName = 'Sales CountD(' + locationName + majorGroupName + ')';
    
            if (!newGroupedData[timeKey]) {
                newGroupedData[timeKey] = {
                    Time: transactionDateTime.getHours() + ':' + transactionDateTime.getMinutes(),
                    Date: transactionDateTime.getDate() + '/' + (transactionDateTime.getMonth() + 1) + '/' + transactionDateTime.getFullYear(),
                    'Data Point': '0',
                    'Data Type': 'sales count',
                    'Data Stream Name': dataStreamName,
                };
            }
    
            var adjustment = 0;
            if (reportLineTotal >= 0) {
                adjustment = reportlineCount;
            } else if (reportLineTotal < 0) {
                adjustment = -Math.abs(reportlineCount);
            } 
    
            newGroupedData[timeKey]['Data Point'] = (parseInt(newGroupedData[timeKey]['Data Point']) + adjustment).toString();
        }
    } else {
        if (allowedRevenueCenters.includes(revenueCenterName)) {
            const roundedMinutes = Math.floor(transactionDateTime.getMinutes() / 15) * 15;
            transactionDateTime.setMinutes(roundedMinutes, 0, 0);
    
            const timeKey = transactionDateTime.toISOString() + '_' + majorGroupName;
            const dataStreamName = 'Sales Count(' + locationName + majorGroupName + ')';
    
            if (!newGroupedData[timeKey]) {
                newGroupedData[timeKey] = {
                    Time: transactionDateTime.getHours() + ':' + transactionDateTime.getMinutes(),
                    Date: transactionDateTime.getDate() + '/' + (transactionDateTime.getMonth() + 1) + '/' + transactionDateTime.getFullYear(),
                    'Data Point': '0',
                    'Data Type': 'sales count',
                    'Data Stream Name': dataStreamName,
                };
            }
    
            var adjustment = 0;
            if (reportLineTotal >= 0) {
                adjustment = reportlineCount;
            } else if (reportLineTotal < 0) {
                adjustment = -Math.abs(reportlineCount);
            } 
    
            newGroupedData[timeKey]['Data Point'] = (parseInt(newGroupedData[timeKey]['Data Point']) + adjustment).toString();
        }
    }

}

output = Object.values(groupedData).concat(Object.values(newGroupedData));
```
