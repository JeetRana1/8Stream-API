// Quick test to verify the mediaInfo endpoint returns consistent structure
import axios from 'axios';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function testMediaInfo(id: string, type: string, description: string) {
    console.log(`\n🧪 Testing: ${description}`);
    console.log(`   ID: ${id}, Type: ${type}`);

    try {
        const url = `${BASE_URL}/api/mediainfo?id=${id}&type=${type}`;
        const response = await axios.get(url, { timeout: 30000 });
        const data = response.data;

        // Verify structure
        const hasRequiredFields =
            typeof data.success === 'boolean' &&
            data.data !== undefined &&
            Array.isArray(data.extraSources) &&
            typeof data.source === 'string';

        if (!hasRequiredFields) {
            console.log('   ❌ FAIL: Missing required fields');
            console.log('   Response:', JSON.stringify(data, null, 2));
            return false;
        }

        console.log(`   ✅ PASS: Consistent structure`);
        console.log(`   Success: ${data.success}`);
        console.log(`   Primary playlist items: ${data.data.playlist?.length || 0}`);
        console.log(`   Alternative sources: ${data.extraSources.length}`);

        if (data.message) {
            console.log(`   Message: ${data.message}`);
        }

        // Check if we have any playable content
        const hasContent =
            (data.data.playlist && data.data.playlist.length > 0) ||
            data.extraSources.length > 0;

        console.log(`   Playable: ${hasContent ? 'Yes' : 'No'}`);

        return true;

    } catch (error: any) {
        console.log(`   ❌ ERROR: ${error.message}`);
        if (error.response?.data) {
            console.log('   Response:', JSON.stringify(error.response.data, null, 2));
        }
        return false;
    }
}

async function runTests() {
    console.log('🎬 8Stream API - Response Structure Tests');
    console.log('==========================================');

    const tests = [
        { id: 'tt0137523', type: 'movie', desc: 'Popular movie (Fight Club)' },
        { id: 'tt35149250', type: 'tv', desc: 'Recent TV show' },
        { id: 'tt32897959', type: 'movie', desc: 'Less common movie' },
        { id: 'tt99999999', type: 'movie', desc: 'Invalid/non-existent ID' },
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        const result = await testMediaInfo(test.id, test.type, test.desc);
        if (result) {
            passed++;
        } else {
            failed++;
        }

        // Wait a bit between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n==========================================');
    console.log(`📊 Results: ${passed} passed, ${failed} failed`);
    console.log('==========================================\n');

    if (failed > 0) {
        console.log('⚠️  Some tests failed. Check the output above for details.');
        process.exit(1);
    } else {
        console.log('✅ All tests passed! API is returning consistent structure.');
        process.exit(0);
    }
}

// Run if executed directly
if (require.main === module) {
    runTests().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { testMediaInfo, runTests };
