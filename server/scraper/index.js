// Libs
var Nightmare = require('nightmare');
var _ = require('lodash');
var moment = require('moment');
var squel = require("squel").useFlavour('mysql');

// Instantiations
var db = require('./../db-connect.js')();
var util = require('./../util.js');

var page = new Nightmare();

var options = {};
options.state = 'AL';
options.county = 'madison';

var table = "foreclosures";
var foreclosures = {};
var startDate = moment().add(-1, 'day').format('MM-DD-YYYY');
var endDate = moment().add(1, 'day').format('MM-DD-YYYY');
var scrapeUrl = 'http://www.alabamalegals.com/index.cfm?fuseaction=home';

page.goto(scrapeUrl)
    .wait(100)
    .evaluate(function(startDate, endDate) {
        var els = {};
        els.$startDate = $('#from').val(startDate);
        els.$endDate = $('#to').val(endDate);
    }, function () {}, startDate, endDate)
    .click('[onclick="newSearch()"]')
    .wait()
    .evaluate(function() {
        var foreclosures = {};
        var $rows = $('.jqgrow');

        var postOptions = {};
        postOptions.url = 'components/LegalsGatewayJ.cfc?method=getLegalDetails&returnformat=json&queryformat=column';
        postOptions.method = 'POST';
        postOptions.dataType = 'json';
        postOptions.data = {};
        postOptions.async = false;
        postOptions.success = function (res) {
            var body, isForeclosure;
            if (res.DATA) {
                body = res.DATA.BODY[0];
                isForeclosure = body.toLowerCase().indexOf('foreclosure') > -1;
                if (isForeclosure) {
                    foreclosures[postOptions.data.id] = defineForeclosure(res);
                }
            }
        };

        function defineForeclosure (res) {
            var foreclosure = {};
            var body = res.DATA.BODY
                .join(' || ');
            foreclosure.body = body;
            foreclosure.caseId = res.DATA.REC_NUM[0];
            foreclosure.heading = res.DATA.HEADING[0];
            foreclosure.county = res.DATA.COUNTYNAME[0];
            foreclosure.pubDate = res.DATA.SDATE[0];
            foreclosure.source = res.DATA.NPNAME[0];

            return foreclosure;
        }

        $rows.each(function(i, row) {
            var $row = $(row);
            var id = $row.attr('id');
            // AL Legals expects the `id` field
            postOptions.data.id = id;
            $.ajax(postOptions);
        });

        return foreclosures;
    }, function(scrapedForeclosures) {

        var uids = {};
        uids.scraped = _.keys(scrapedForeclosures);
        uids.present = [];
        uids.absent = [];
        uids.scraped.forEach(function(uid) {
		uid = db.escape(uid);
        });
        uids.sql = uids.scraped.join(', ');

        var SQLFindListing = squel.select().from(table).where("case_id IN (" + uids.sql + ")").toString();
        console.log("1. " + SQLFindListing);
        var query = db.query(SQLFindListing);

        query.on('result', function(result) {
            uids.present.push(result.propertyCase);
        });

        query.on('end', function() {
            var insertedRows = 0;
            uids.absent = _.difference(uids.scraped, uids.present);

            if (uids.absent.length > 0) {
                uids.absent.forEach(function(absentUid) {
                    var absentForeclosure = scrapedForeclosures[absentUid];
                    var pubDate = moment(absentForeclosure.pubDate, 'MM-DD-YYYY').format('YYYY-MM-DD');

                    insertMap = {};
                    insertMap["case_id"] = db.escape(absentForeclosure.caseId);
                    insertMap["county"] = db.escape(absentForeclosure.county);
                    insertMap["body"] = db.escape(absentForeclosure.body);
                    insertMap["source"] = db.escape(absentForeclosure.source);
                    insertMap["pub_date"] = db.escape(pubDate);

                    // Optional
                    // util.encaseInTicks('street_addr'),
                    // util.encaseInTicks('city'),
                    // util.encaseInTicks('sale_location'),
                    // util.encaseInTicks('sale_date'),
                    // util.encaseInTicks('zip'),
                    // util.encaseInTicks('price'),
                    // util.encaseInTicks('bed')
                    // util.encaseInTicks('bath')

                    SQLInsertListing = squel.insert().into(table).setFields(insertMap).toString();
                    console.log("2. " + SQLInsertListing);
                    db.query(SQLInsertListing, function(err) {
                        if (err) {
                            db.end();
                            throw err;
                        }

                        insertedRows++;

                        if (uids.absent.length === insertedRows) {
                            db.end();
                            console.log('WOOOOOOOOOO!');
                        }
                    });
                });
            }
        });
    })
    .run();
