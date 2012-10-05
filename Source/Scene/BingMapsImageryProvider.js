/*!
   Portions Copyright (c) 2006-2009 Microsoft Corporation.  All rights reserved.

   http://msdn.microsoft.com/en-us/library/bb259689.aspx
   http://msdn.microsoft.com/en-us/cc300389.aspx#O

   MICROSOFT LIMITED PUBLIC LICENSE

   This license governs use of code marked as 'sample' or 'example' available on
   this web site without a license agreement, as provided under the section above
   titled 'NOTICE SPECIFIC TO SOFTWARE AVAILABLE ON THIS WEB SITE.' If you use
   such code (the 'software'), you accept this license. If you do not accept the
   license, do not use the software.

   1. Definitions

   The terms 'reproduce,' 'reproduction,' 'derivative works,' and 'distribution'
   have the same meaning here as under U.S. copyright law.

   A 'contribution' is the original software, or any additions or changes to the software.

   A 'contributor' is any person that distributes its contribution under this license.

   'Licensed patents' are a contributor's patent claims that read directly on its contribution.

   2. Grant of Rights

   (A) Copyright Grant - Subject to the terms of this license, including the license
   conditions and limitations in section 3, each contributor grants you a non-exclusive,
   worldwide, royalty-free copyright license to reproduce its contribution, prepare
   derivative works of its contribution, and distribute its contribution or any
   derivative works that you create.

   (B) Patent Grant - Subject to the terms of this license, including the license
   conditions and limitations in section 3, each contributor grants you a
   non-exclusive, worldwide, royalty-free license under its licensed patents to
   make, have made, use, sell, offer for sale, import, and/or otherwise dispose
   of its contribution in the software or derivative works of the contribution
   in the software.

   3. Conditions and Limitations

   (A) No Trademark License- This license does not grant you rights to use any
   contributors' name, logo, or trademarks.

   (B) If you bring a patent claim against any contributor over patents that
   you claim are infringed by the software, your patent license from such
   contributor to the software ends automatically.

   (C) If you distribute any portion of the software, you must retain all
   copyright, patent, trademark, and attribution notices that are present in
   the software.

   (D) If you distribute any portion of the software in source code form, you
   may do so only under this license by including a complete copy of this license
   with your distribution. If you distribute any portion of the software in
   compiled or object code form, you may only do so under a license that
   complies with this license.

   (E) The software is licensed 'as-is.' You bear the risk of using it. The
   contributors give no express warranties, guarantees or conditions. You may
   have additional consumer rights under your local laws which this license
   cannot change. To the extent permitted under your local laws, the contributors
   exclude the implied warranties of merchantability, fitness for a particular
   purpose and non-infringement.

   (F) Platform Limitation - The licenses granted in sections 2(A) and 2(B)
   extend only to the software or derivative works that you create that run
   on a Microsoft Windows operating system product.
 */
/*global define*/
define([
        '../Core/defaultValue',
        '../Core/jsonp',
        '../Core/DeveloperError',
        '../Core/Cartesian2',
        './BingMapsStyle',
        './DiscardMissingTileImagePolicy',
        './ImageryProvider',
        './WebMercatorTilingScheme',
        '../ThirdParty/when'
    ], function(
        defaultValue,
        jsonp,
        DeveloperError,
        Cartesian2,
        BingMapsStyle,
        DiscardMissingTileImagePolicy,
        ImageryProvider,
        WebMercatorTilingScheme,
        when) {
    "use strict";

    /**
     * Provides tiled imagery using the Bing Maps Imagery REST API.
     *
     * @alias BingMapsImageryProvider
     * @constructor
     *
     * @param {String} description.server The name of the Bing Maps server hosting the imagery.
     * @param {String} [description.key] An optional Bing Maps key, which can be created at
     *        <a href='https://www.bingmapsportal.com/'>https://www.bingmapsportal.com/</a>.
     * @param {Enumeration} [description.mapStyle=BingMapsStyle.AERIAL] The type of Bing Maps
     *        imagery to load.
     * @param {TileDiscardPolicy} [description.tileDiscardPolicy] The policy that determines if a tile
     *        is invalid and should be discarded.  If this value is not specified, a default
     *        {@link DiscardMissingTileImagePolicy} is used which requests
     *        tile 0,0 at the maximum tile level and checks pixels (0,0), (120,140), (130,160),
     *        (200,50), and (200,200).  If all of these pixels are transparent, the discard check is
     *        disabled and no tiles are discarded.  If any of them have a non-transparent color, any
     *        tile that has the same values in these pixel locations is discarded.  The end result of
     *        these defaults should be correct tile discarding for a standard Bing Maps server.  To ensure
     *        that no tiles are discarded, construct and pass a {@link NeverTileDiscardPolicy} for this
     *        parameter.
     * @param {Proxy} [description.proxy] A proxy to use for requests. This object is
     *        expected to have a getURL function which returns the proxied URL, if needed.
     *
     * @exception {DeveloperError} <code>description.server</code> is required.
     *
     * @see ArcGisMapServerImageryProvider
     * @see SingleTileImageryProvider
     * @see OpenStreetMapImageryProvider
     * @see WebMapServiceImageryProvider
     *
     * @see <a href='http://msdn.microsoft.com/en-us/library/ff701713.aspx'>Bing Maps REST Services</a>
     * @see <a href='http://www.w3.org/TR/cors/'>Cross-Origin Resource Sharing</a>
     *
     * @example
     * var bing = new BingMapsImageryProvider({
     *     server : 'dev.virtualearth.net',
     *     mapStyle : BingMapsStyle.AERIAL
     * });
     */
    var BingMapsImageryProvider = function BingMapsImageryProvider(description) {
        description = defaultValue(description, {});

        if (typeof description.server === 'undefined') {
            throw new DeveloperError('description.server is required.');
        }

        this._server = description.server;
        this._key = defaultValue(description.key, 'AquXz3981-1ND5jGs8qQn7R7YUP8qkWi77yZSVM7o3nIvzb-Mg0W2Ta57xuUyywX');
        this._mapStyle = defaultValue(description.mapStyle, BingMapsStyle.AERIAL);
        this._tileDiscardPolicy = description.tileDiscardPolicy;
        this._proxy = description.proxy;

        this._tilingScheme = new WebMercatorTilingScheme({
            numberOfLevelZeroTilesX : 2,
            numberOfLevelZeroTilesY : 2
        });

        this._tileWidth = undefined;
        this._tileHeight = undefined;
        this._maximumLevel = undefined;
        this._imageUrlTemplate = undefined;
        this._imageUrlSubdomains = undefined;

        this._ready = false;

        var metadataUrl = 'http://' + this._server + '/REST/v1/Imagery/Metadata/' + this._mapStyle.imagerySetName + '?key=' + this._key;
        var that = this;
        when(jsonp(metadataUrl, {
            callbackParameterName : 'jsonp',
            proxy : this._proxy
        }), function(data) {
            var resource = data.resourceSets[0].resources[0];

            that._tileWidth = resource.imageWidth;
            that._tileHeight = resource.imageHeight;
            that._maximumLevel = resource.zoomMax - 1;
            that._imageUrlSubdomains = resource.imageUrlSubdomains;
            that._imageUrlTemplate = resource.imageUrl.replace('{culture}', '');

            // Install the default tile discard policy if none has been supplied.
            if (typeof that._tileDiscardPolicy === 'undefined') {
                that._tileDiscardPolicy = new DiscardMissingTileImagePolicy({
                    missingImageUrl : buildImageUrl(that, 0, 0, that._maximumLevel),
                    pixelsToCheck : [new Cartesian2(0, 0), new Cartesian2(120, 140), new Cartesian2(130, 160), new Cartesian2(200, 50), new Cartesian2(200, 200)],
                    disableCheckIfAllPixelsAreTransparent : true
                });
            }

            that._ready = true;
        });
    };

    function buildImageUrl(imageryProvider, x, y, level) {
        var imageUrl = imageryProvider._imageUrlTemplate;

        var quadkey = BingMapsImageryProvider.tileXYToQuadKey(x, y, level);
        imageUrl = imageUrl.replace('{quadkey}', quadkey);

        var subdomains = imageryProvider._imageUrlSubdomains;
        var subdomainIndex = (x + y + level) % subdomains.length;
        imageUrl = imageUrl.replace('{subdomain}', subdomains[subdomainIndex]);

        var proxy = imageryProvider._proxy;
        if (typeof proxy !== 'undefined') {
            imageUrl = proxy.getURL(imageUrl);
        }

        return imageUrl;
    }

    /**
     * Gets the name of the Bing Maps server hosting the imagery.
     *
     * @memberof BingMapsImageryProvider
     *
     * @returns {String} The server name.
     */
    BingMapsImageryProvider.prototype.getServer = function() {
        return this._server;
    };

    /**
     * Gets the Bing Maps key.
     *
     * @memberof BingMapsImageryProvider
     *
     * @returns {String} The key.
     */
    BingMapsImageryProvider.prototype.getKey = function() {
        return this._key;
    };

    /**
     * Gets the type of Bing Maps imagery to load.
     *
     * @memberof BingMapsImageryProvider
     *
     * @returns {BingMapsStyle} The style.
     */
    BingMapsImageryProvider.prototype.getMapStyle = function() {
        return this._mapStyle;
    };

    /**
     * Gets the width of each tile, in pixels.  This function should
     * not be called before {@link BingMapsImageryProvider#isReady} returns true.
     *
     * @memberof BingMapsImageryProvider
     *
     * @returns {Number} The width.
     */
    BingMapsImageryProvider.prototype.getTileWidth = function() {
        return this._tileWidth;
    };

    /**
     * Gets the height of each tile, in pixels.  This function should
     * not be called before {@link BingMapsImageryProvider#isReady} returns true.
     *
     * @memberof BingMapsImageryProvider
     *
     * @returns {Number} The height.
     */
    BingMapsImageryProvider.prototype.getTileHeight = function() {
        return this._tileHeight;
    };

    /**
     * Gets the maximum level-of-detail that can be requested.  This function should
     * not be called before {@link BingMapsImageryProvider#isReady} returns true.
     *
     * @memberof BingMapsImageryProvider
     *
     * @returns {Number} The maximum level.
     */
    BingMapsImageryProvider.prototype.getMaximumLevel = function() {
        return this._maximumLevel;
    };

    /**
     * Gets the tiling scheme used by this provider.  This function should
     * not be called before {@link BingMapsImageryProvider#isReady} returns true.
     *
     * @memberof BingMapsImageryProvider
     *
     * @returns {TilingScheme} The tiling scheme.
     * @see WebMercatorTilingScheme
     * @see GeographicTilingScheme
     */
    BingMapsImageryProvider.prototype.getTilingScheme = function() {
        return this._tilingScheme;
    };

    /**
     * Gets the extent, in radians, of the imagery provided by this instance.  This function should
     * not be called before {@link BingMapsImageryProvider#isReady} returns true.
     *
     * @memberof BingMapsImageryProvider
     *
     * @returns {Extent} The extent.
     */
    BingMapsImageryProvider.prototype.getExtent = function() {
        return this._tilingScheme.getExtent();
    };

    /**
     * Gets the tile discard policy.  If not undefined, the discard policy is responsible
     * for filtering out "missing" tiles via its shouldDiscardImage function.  If this function
     * returns undefined, no tiles are filtered.  This function should
     * not be called before {@link BingMapsImageryProvider#isReady} returns true.
     *
     * @memberof BingMapsImageryProvider
     *
     * @returns {TileDiscardPolicy} The discard policy.
     *
     * @see DiscardMissingTileImagePolicy
     * @see NeverTileDiscardPolicy
     */
    BingMapsImageryProvider.prototype.getTileDiscardPolicy = function() {
        return this._tileDiscardPolicy;
    };

    /**
     * Gets a value indicating whether or not the provider is ready for use.
     *
     * @memberof BingMapsImageryProvider
     *
     * @returns {Boolean} True if the provider is ready to use; otherwise, false.
     */
    BingMapsImageryProvider.prototype.isReady = function() {
        return this._ready;
    };

    /**
     * Requests the image for a given tile.  This function should
     * not be called before {@link BingMapsImageryProvider#isReady} returns true.
     *
     * @memberof BingMapsImageryProvider
     *
     * @param {Number} x The tile X coordinate.
     * @param {Number} y The tile Y coordinate.
     * @param {Number} level The tile level.
     *
     * @returns {Promise} A promise for the image that will resolve when the image is available, or
     *          undefined if there are too many active requests to the server, and the request
     *          should be retried later.  The resolved image may be either an
     *          Image or a Canvas DOM object.
     */
    BingMapsImageryProvider.prototype.requestImage = function(x, y, level) {
        var url = buildImageUrl(this, x, y, level);
        return ImageryProvider.loadImage(url);
    };

    /**
     * Gets the logo to display when this imagery provider is active.  Typically this is used to credit
     * the source of the imagery.  This function should not be called before {@link BingMapsImageryProvider#isReady} returns true.
     *
     * @memberof BingMapsImageryProvider
     *
     * @returns {Image|Canvas} A canvas or image containing the log to display, or undefined if there is no logo.
     */
    BingMapsImageryProvider.prototype.getLogo = function() {
        if (typeof BingMapsImageryProvider._logo === 'undefined') {
            var image = new Image();
            image.loaded = false;
            image.onload = function() {
                BingMapsImageryProvider._logo.loaded = true;
            };
            image.src = BingMapsImageryProvider._logoData;
            BingMapsImageryProvider._logo = image;
        }

        var logo = BingMapsImageryProvider._logo;
        return (logo && logo.loaded) ? logo : undefined;
    };

    /**
     * Gets the ambient lighting intensity to use when this imagery provider is the base layer.  This can
     * be used to lighten dark imagery or darken light imagery.
     *
     * @memberof BingMapsImageryProvider
     *
     * @param {Number} x The imagery tile X coordinate.
     * @param {Number} y The imagery tile Y coordinate.
     * @param {Number} level The imagery tile level-of-detail.
     * @returns {Number} The ambient light intensity to use for this tile.
     */
    BingMapsImageryProvider.prototype.getIntensity = function(x, y, level) {
        if ((this._mapStyle === BingMapsStyle.AERIAL || this._mapStyle === BingMapsStyle.AERIAL_WITH_LABELS) && level <= 7.0) {
            return 1.0;
        }
        return 0.1;
    };

    /**
     * Gets the ambient lighting intensity to use for the poles when this imagery provider is the base
     * layer.  This can be used to lighten dark imagery or darken light imagery.
     *
     * @memberof BingMapsImageryProvider
     *
     * @returns {Number} The ambient light intensity to use for the poles.
     */
    BingMapsImageryProvider.prototype.getPoleIntensity = function() {
        return 1.0;
    };

    BingMapsImageryProvider._logo = undefined;
    BingMapsImageryProvider._logoLoaded = false;
    BingMapsImageryProvider._logoData = 'data:image/png;base64,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';

    /**
     * Converts a tiles (x, y, level) position into a quadkey used to request an image
     * from a Bing Maps server.
     *
     * @memberof BingMapsImageryProvider
     *
     * @param {Number} x The tile's x coordinate.
     * @param {Number} y The tile's y coordinate.
     * @param {Number} level The tile's zoom level.
     *
     * @see <a href='http://msdn.microsoft.com/en-us/library/bb259689.aspx'>Bing Maps Tile System</a>
     * @see BingMapsImageryProvider#quadKeyToTileXY
     */
    BingMapsImageryProvider.tileXYToQuadKey = function(x, y, level) {
        ++level;
        var quadkey = '';
        for ( var i = level; i > 0; --i) {
            var digit = '0'.charCodeAt(0);
            var mask = 1 << (i - 1);
            if ((x & mask) !== 0) {
                digit++;
            }
            if ((y & mask) !== 0) {
                digit += 2;
            }
            quadkey += String.fromCharCode(digit);
        }
        return quadkey;
    };

    /**
     * Converts a tile's quadkey used to request an image from a Bing Maps server into the
     * (x, y, level) position.
     *
     * @memberof BingMapsImageryProvider
     *
     * @param {String} quadkey The tile's quad key
     *
     * @see <a href='http://msdn.microsoft.com/en-us/library/bb259689.aspx'>Bing Maps Tile System</a>
     * @see BingMapsImageryProvider#tileXYToQuadKey
     */
    BingMapsImageryProvider.quadKeyToTileXY = function(quadkey) {
        var result = {
            x : 0,
            y : 0,
            level : quadkey.length
        };

        for ( var i = result.level; i > 0; --i) {
            var mask = 1 << (i - 1);
            var c = quadkey[result.level - i];
            if (c === '1') {
                result.x |= mask;
            } else if (c === '2') {
                result.y |= mask;
            } else if (c === '3') {
                result.x |= mask;
                result.y |= mask;
            }
        }

        --result.level;

        return result;
    };

    return BingMapsImageryProvider;
});